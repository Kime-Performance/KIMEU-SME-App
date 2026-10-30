---
name: Isolated React UI fixtures
description: Avoid misleading hook failures when testing authenticated components without live data.
---

Standalone browser-test bundles must resolve React, React DOM, and React Query from the target frontend package consistently.

**Why:** This pnpm workspace can contain multiple React dependency instances. An isolated bundle built from outside the frontend rendered an invalid-hook-call error until those dependencies were explicitly deduplicated; the actual app was not broken.

**How to apply:** For synthetic, no-live-data tests of signed-in components, align dependency resolution with the frontend before diagnosing hook errors as product bugs. Keep fixture network traffic mocked and remove temporary bundles after testing.
