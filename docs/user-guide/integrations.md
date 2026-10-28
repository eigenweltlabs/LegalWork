# Integrations

Open in LegalWork: [Connectors](legalwork://app/settings/extensions/mcp), [Plugins](legalwork://app/settings/extensions/plugins).

## Connectors, storage, skills and plugins

Open **Settings > Integrations**. Its tabs separate **Plugins**, **Skills** and **File storage**. Connectors appear in the Plugins library. A catalogue entry is an available integration, not proof it is connected.

To add a connector, press **Add**, choose **Plugins** to open the **Plugin catalogue**, then search for and select the connector, such as **Gmail** or **Outlook Email**. Follow its setup flow. Do not skip **Add** when the connector has not been added yet. To manage an existing connector, open its entry in the library. Some use browser sign-in; others need an API key, local command or remote MCP URL. A custom MCP connection can use the supported local-command or remote-server configuration. Complete authentication and check its connection status. Reload the agent when the app requests it so the new tools become available.

An MCP server publishes tools with its own access requirements. Local-command integrations run on the computer running LegalWork, so required software and credentials must exist there. A remote MCP URL connects to the external service instead of starting its program locally. A disabled connector or expired authorization can leave a card visible while its tools fail or are absent.

Plugins add OpenCode tools or hooks. Use the Plugins tab's supported installation/import flow, including the Claude-plugin bundle preview when offered. Previewing a package does not establish that every third-party component works in this runtime. Follow any reported compatibility errors. Most repeatable drafting procedures need a skill or workflow rather than a custom plugin.

## Research databases

The **Your legal research** welcome screen helps you connect accounts you already use, including beck-online, juris, Lexis and Westlaw. Country suggestions cover the EU, UK and US. They are a starting list, not a guarantee that your subscription covers a particular matter or jurisdiction.

1. During onboarding, choose the country you work in. Later, open **Settings > Integrations > Add > Research databases** to use the same setup.
2. Select one or more suggested databases. Search by name, such as “Beck”, to search all countries. Choose **Add another database** for an unlisted service, enter its name and **Research website**, and provide its **Sign-in website (if different)** when the provider uses a separate login website.
3. Choose **Set up selected databases** or **Set up integration**. Each selected service gets its own **Sign-in details needed** card. The website is already filled in for verified login addresses. If a provider’s current login address could not be confirmed, enter the address of its password page first. Enter your username and password, then choose **Save and continue**. If a matching login is already saved, choose **Continue with saved login** instead.
4. Continue after the integrations have been added. Use **Set up later** to skip optional setup. Find the result under **Integrations > Plugins**; it is available in all your projects on this LegalWork installation.
5. Ask, for example, “Research this question in beck-online and cite the relevant judgments.” The assistant opens the provider in **Browser Automation**, signs in with the saved login and checks access. Complete any MFA, CAPTCHA or institutional sign-in in the visible browser when requested.

Passwords use LegalWork's existing encrypted vault. The integration's skill stores the database addresses and a saved-login reference, never the password. Manage or delete logins in **Settings > Secrets > Browser passwords**. Removing the integration does not delete a saved login that other tasks may still use. Sharing the plugin does not share your password; the recipient must set up their own login.

The research website and sign-in website can have different domains. For example, Lexis+ opens at `plus.lexis.com` but signs in at `signin.lexisnexis.com`. Only the actual sign-in website needs a saved password. Its main domain and subdomains already share access within the vault's existing rules. If the site redirects to an unrelated sign-in domain, the assistant asks for that login in a new secure card instead of copying a password automatically.

**CourtListener** appears under **United States** with a **Free account** label. Register at [CourtListener](https://www.courtlistener.com/register/) for a free individual account, then use it to test sign-in and US case-law research without buying a subscription. Paid memberships and paid PACER retrieval are separate. A provider's access check or blocked page still requires attention in the visible browser.

“Set up” confirms that the integration and saved-login reference exist. It does not confirm a successful provider login or access to every database module. If setup fails after saving a login, choose **Continue with saved login** to retry. If you edited the installed skill yourself, LegalWork preserves those edits; review or remove the existing plugin before recreating it. If your organization disables custom integrations or skills, your administrator manages this setup. Browser password filling requires the local desktop browser.

## LegalMemory and firm knowledge

LegalMemory is a separate Eigenwelt knowledge index. Connect the firm's instance using its connector when available. Search its live records for matters, documents and other firm knowledge; inspect the returned source evidence. Connecting ordinary file storage does not automatically create a LegalMemory index.

A disconnected connector's historical output, old chats or runtime caches are not substitutes for the live source. If the firm has not connected LegalMemory, use the source the user identifies or the available connected storage. A failed search is not evidence that the matter does not exist everywhere.

## Google Workspace and other services

For Gmail and Outlook setup, connection methods, write permissions and troubleshooting, read [Email setup](email.md). The native catalog also includes Google Calendar, Outlook Calendar, Google Drive, OneDrive and SharePoint. Each connector has its own supported operations and write-access setting. Outlook Email and Calendar share an account but activate separately.

Connecting a calendar service lets the assistant use that service's available tools. It does not automatically import those events into LegalWork's project Calendar. Connecting a drive does not establish mail access. Check the individual connector's status and granted permissions.

## Browser and Computer Use

The built-in browser opens websites in a browser panel. Ask the assistant to open a URL and inspect the page with the browser tools. Opening or reconnecting a tab gives the assistant a page observation it can use directly for searches, forms, links and other interactions. It can perform known steps together, then inspect the result; a new page or an unexpected result requires another observation. For saved website passwords, use **Settings > Secrets > Browser passwords**; see [browser password setup and limits](settings-privacy.md#browser-passwords). Filling uses the existing tab. Background task tabs remain available after the assistant finishes, so you can reopen them from their chat cards or continue in the same tab on a follow-up. Close a tab when you no longer need it. Website sign-ins, downloads and site permissions are separate from LegalWork model-provider sign-in. Inspect the returned file location after downloading.

Computer Use controls desktop applications and is configured from its integration card. The built-in desktop integration in this build targets macOS and requires Accessibility and Screen Recording permissions. Use its setup/test controls to confirm readiness. For LegalWork's own navigation, prefer the app's UI action tools so the assistant can open settings or sessions directly. Browser automation is for web content, not an assumption that LegalWork's native controls are a website.

Additional integrations, including media capabilities, depend on installed packages and their credentials. The live catalog and returned tool descriptions are authoritative for those tools.

Related: [Storage](connected-storage.md), [Skills](skills-workflows.md), [Audio](audio.md), [Feature availability](feature-availability.md).
