---
ocjs: patch
---

Publish libcascade.xyz from Cloudflare Pages instead of Vercel. The docs site is now a static export: CI builds it from the tested candidate tarball and uploads it with Wrangler, as a preview for each same-repository pull request and as production from `main`. The package itself is unchanged.
