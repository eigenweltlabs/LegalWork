import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AudioStep } from "../src/react-app/domains/onboarding/audio-step";
import { useRecorderStore } from "../src/react-app/domains/recorder/recorder-store";

test("Recorder setup does not ask for Dictate Anywhere permissions", () => {
  const initial = useRecorderStore.getInitialState();
  const previous = { ...initial };
  Object.assign(initial, {
    permissions: { platform: "darwin", packaged: true, microphone: "not-determined", systemAudio: "not-determined" },
    dictationReadiness: { platform: "darwin", packaged: true, microphone: "not-determined", inputMonitoring: "not-determined", accessibility: "denied", automation: "not-determined" },
  });
  const queryClient = new QueryClient();
  try {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <AudioStep legalworkClient={null} workspaceId={null} onBack={() => {}} onDone={() => {}} />
      </QueryClientProvider>,
    );
    expect(html).toContain("Microphone");
    expect(html).toContain("System &amp; app audio");
    expect(html).toContain("Speech model");
    expect(html).not.toContain("Input Monitoring");
    expect(html).not.toContain("Accessibility");
    expect(html).not.toContain("Insert dictated text");
    expect(html).not.toContain('data-testid="onboarding-dictation-permissions"');
  } finally {
    queryClient.clear();
    Object.assign(initial, previous);
  }
});
