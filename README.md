# Aestry

An open-source, local-first, self-hostable AI design studio for creating app icons, project logos, and Open Graph images.

Built with Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui (Base Nova), and pnpm.

## How it works

Aestry is conversation-first, not prompt-to-image. You describe what you want, a **multimodal model** consults with you (asking questions when needed, analyzing reference images, proposing directions), and once a structured **design brief** is ready, you explicitly approve generation with your **image generation model**. Results appear inline in the same conversation, and you keep refining from there.

```
You describe the idea
        |
  Conversation session
        |
  Design consultant (multimodal model)
        |   clarifies, analyzes references, proposes
        v
  Structured design brief  ->  your approval
        |
  Image generation (image model, per approved brief)
        |
  Inline results -> refine / regenerate / download
```

### Model roles

Each provider record can expose two roles, and you choose which provider/model fills each role on the **Providers** page — nothing is selected implicitly:

- **Consultation model** (multimodal): powers the design consultant — brainstorming, chat, and reading reference images.
- **Image generation model**: produces the assets when you approve a brief.

A single provider can serve both roles, or you can mix providers.

### Skills

Asset types are internal skills, each shaping both consultation and generation:

- **App Icon** — square composition, strong silhouette, small-size legibility.
- **Logo** — brand marks and wordmarks, distinctiveness and scalability.
- **OG Image** — landscape (~1200×630) social preview cards with clear hierarchy.

The final image prompt is compiled **server-side** from the validated brief and the selected skill's constraints — the client never supplies privileged generation instructions.

## Providers (BYOK)

Configure providers on `/providers`:

- Built-in **Google Gemini** (paste an [AI Studio](https://aistudio.google.com/apikey) key).
- Any **OpenAI-compatible** endpoint (base URL + key).

Available models are **loaded from the provider itself** (`ListModels` for Google, `GET /models` for OpenAI-compatible endpoints) and split into the two roles above. Nothing is hardcoded.

### API-key transport (please read)

API keys are stored in your **browser's localStorage** — not encrypted at rest. When you consult or generate, the key travels:

```
Your browser -> your self-hosted Aestry server -> the configured provider
```

The server uses a key only for the request it belongs to and never persists or logs it. There is no end-to-end encryption, and anyone who can access your deployment can observe provider traffic — keep untrusted networks away from your instance.

### Storage

- **Conversations, messages, design briefs, and generated images** live in your browser's **IndexedDB** (via `idb`). Refreshes restore them; the History page opens or deletes them (blobs included).
- **Provider credentials** live in localStorage, separate from conversation storage. No credentials ever enter conversation records, prompts, or error messages.
- Browser storage is finite. Very large image batches can hit quota; failures surface as warnings and conversation state stays in memory.

## Provider capabilities (honesty notes)

- Model capability classification during discovery is a **heuristic**, not a verified guarantee.
- Not every multimodal model accepts image input — Aestry checks an inferred capability before sending references and tells you when it skipped them.
- The OpenAI-compatible `images/generations` path does **not** accept reference images; requests through it say so instead of pretending they mattered.
- Google image models accept reference images (editing-style conditioning). Refinement without image input is a **new generation guided by the brief**, not a pixel-perfect edit.
- Raster models do not produce SVG/vector files, and generated lettering (especially in OG images) may contain rendering mistakes — always review.

## GitHub project context

If a message contains a public `github.com` repository URL, Aestry can gather bounded, read-only context (description, language, topics, README excerpt) and feed it to the consultant as clearly-labeled, untrusted reference material. No cloning, no code execution, no private-repo access. If fetching fails, the conversation continues without it.

## Security notes

- All API requests are treated as untrusted: outbound requests to user-configured endpoints validate protocol and destination (private ranges and cloud metadata hosts blocked by default), and redirects are re-validated per hop.
- Self-hosted local providers (e.g. LM Studio on `localhost`) require `AESTRY_ALLOW_PRIVATE_ENDPOINTS=true` on the server.
- Generated-image URL downloads are content-type checked and size-bounded.
- Known limitation: hostname validation is lexical; DNS-rebinding protection is left to network-level controls for exposed deployments.

## Development

```bash
pnpm install
pnpm dev        # local development (manual browser testing)
pnpm typecheck  # TypeScript
pnpm lint       # ESLint
pnpm test       # vitest unit tests (mocked providers, no network)
pnpm build      # production build
pnpm audit      # dependency audit
```

What is verified by static checks and tests: type safety, lint rules, production build, skill prompt compilation, consultation parsing (including malformed model output), conversation turn bounding, outbound URL policy, and provider response parsing with mocked providers.

What still requires **you**: visual/UX review across themes and breakpoints, and live generation against real provider keys (never exercised by the automated suite).
