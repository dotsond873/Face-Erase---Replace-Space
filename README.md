# Face Erase & Replace

Upload a base photo and a replacement photo, describe the edit, generate, and download the result. JPEG, PNG, and WebP are supported, up to 10 MB and 25 megapixels per input.

## Deployment

Use the repository Dockerfile on Render with a blank Root Directory. It builds and serves the interface and `/api` from one service, using Render's `PORT`. Set these private server environment variables:

- `GEMINI_API_KEY`: a Google Gemini API key with access to image generation. Direct Google usage is subject to the account's quota and billing; no free image generation is promised.
- `GEMINI_IMAGE_MODEL`: optional; defaults to `gemini-2.5-flash-image`.
- `MONGO_URL`: MongoDB connection URI.
- `DB_NAME`: database name, for example `face_erase`.

The app no longer uses the Emergent runtime, key, visual editing dependency, badge, or analytics scripts. Never put the Gemini key in frontend environment variables. `/health` reports key presence, not a successful generation or database connection.

For separate frontend hosting, set `REACT_APP_BACKEND_URL` to the backend HTTPS URL before building.

Archive entries are scoped to a random browser identifier stored locally. This is a personal app session, not a user account or authentication system. Existing archive entries without that identifier are preserved in MongoDB but no longer publicly listed. Clearing browser data loses access to that browser's archive.

## Verification

Install backend requirements plus pytest, then run `python -m pytest tests -q`. The provider response is mocked in tests; a real edit requires configured credentials and an end-to-end deployment check. Build the frontend using `npm ci --legacy-peer-deps && npm run build` from `frontend`.
