/** Local demo only. Credentials stay outside the repository and are never logged.
 * pnpm --filter legalwork-server exec bun scripts/upload-harvey-firm-s3.ts /path/to/corpus
 * Expects files/, source-tree.json, LICENSE, README.md and s3-credentials.json.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { S3Client, CreateBucketCommand, HeadBucketCommand, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { z } from "zod";

const root = resolve(z.string().min(1).parse(process.argv[2]));
const source = z.object({
  repository: z.literal("harveyai/harvey-labs"), commit: z.string().regex(/^[a-f0-9]{40}$/),
  subdirectory: z.literal("tasks/firm-knowledge"), truncated: z.literal(false),
  tree: z.array(z.object({ path: z.string().min(1), type: z.enum(["blob", "tree"]), sha: z.string(), size: z.number().optional() })),
}).parse(JSON.parse(await readFile(join(root, "source-tree.json"), "utf8")));
const credentials = z.object({ accessKeyId: z.string().min(1), secretAccessKey: z.string().min(1) })
  .parse(JSON.parse(await readFile(join(root, "s3-credentials.json"), "utf8")));
const endpoint = "http://127.0.0.1:3195", bucket = `harvey-firm-knowledge-${source.commit.slice(0, 8)}`;
const client = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials });
try { await client.send(new HeadBucketCommand({ Bucket: bucket })); }
catch (error) {
  if (!(error instanceof Error) || error.name !== "NotFound") throw error;
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
}
const files = source.tree.filter(entry => entry.type === "blob");
const expected = new Map<string, { bytes: number; md5: string }>();
let position = 0, completed = 0;
await Promise.all(Array.from({ length: 12 }, async () => {
  while (position < files.length) {
    const entry = files[position++]!;
    if (entry.path.startsWith("/") || entry.path.split("/").some(part => part === ".." || part === "." || part.includes("\\"))) throw new Error("Unsafe source path");
    const body = await readFile(join(root, "files", entry.path));
    const gitHash = createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
    if (body.length !== entry.size || gitHash !== entry.sha) throw new Error(`Source verification failed: ${entry.path}`);
    const md5 = createHash("md5").update(body).digest();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: entry.path, Body: body, ContentMD5: md5.toString("base64"), Metadata: { "git-blob": gitHash, "source-commit": source.commit } }));
    expected.set(entry.path, { bytes: body.length, md5: md5.toString("hex") });
    if (++completed % 500 === 0) console.log(`${completed}/${files.length} source files uploaded`);
  }
}));
for (const name of ["LICENSE", "README.md", "source-tree.json"]) {
  const body = await readFile(join(root, name));
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: `_provenance/${name}`, Body: body, ContentMD5: createHash("md5").update(body).digest("base64") }));
}
let cursor: string | undefined, verified = 0, bytes = 0;
do {
  const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: cursor }));
  for (const object of page.Contents ?? []) {
    if (object.Key?.startsWith("_provenance/")) continue;
    const item = object.Key ? expected.get(object.Key) : undefined;
    if (!item || object.Size !== item.bytes || object.ETag !== `"${item.md5}"`) throw new Error(`Uploaded object mismatch: ${object.Key}`);
    expected.delete(object.Key!); verified++; bytes += item.bytes;
  }
  cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
  if (page.IsTruncated && !cursor) throw new Error("Truncated S3 listing without continuation token");
} while (cursor);
if (expected.size) throw new Error(`${expected.size} source files missing from S3`);
const manifest = { repository: source.repository, commit: source.commit, subdirectory: source.subdirectory, endpoint, bucket, connectionPrefix: "dms", verified, bytes, verifiedAt: new Date().toISOString() };
await writeFile(join(root, "s3-manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
client.destroy();
