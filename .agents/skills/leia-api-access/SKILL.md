---
name: leia-api-access
description: Use this skill whenever the user wants to operate, test, document, debug, or script LEIA Partner API access workflows, especially agentic course creation via REST API keys. This includes creating courses through the multi-step Partner API pipeline, polling jobs, generating lesson content, slides, or videos, checking RAG/job/course status, and writing curl/HTTP client scripts. Prefer this skill for any mention of LEIA API access, Partner API, api keys, REST course creation, curriculum jobs, lesson generation, slides generation, or API-driven course automation. Do not use the YOLO /courses/create-full route unless the user explicitly asks for YOLO; this skill defaults to the reviewed multi-step flow.
---

# LEIA Partner API Access

Use this skill to help agents safely operate the LEIA Partner API. The goal is to make API usage reliable, inspectable, and easy to recover from when async generation jobs fail or overshoot.

## Default stance

Prefer the explicit multi-step Partner API flow over one-shot automation. It gives the user and agent chances to inspect intermediate results, especially generated curriculum, before creating large courses or spending generation quota.

Do **not** use `POST /courses/create-full` by default. That YOLO route is intentionally excluded for now. Mention it only if the user explicitly asks about YOLO or one-call pipelines.

## Required context

Before making requests, establish:

- `BASE_URL`
  - Local dev: `http://localhost:3000/api/v1`
  - Production: `https://api.leia.io/api/v1`
- API key
  - Use `Authorization: Bearer leia_sk_...`
  - Never print or commit real API keys unless the user has already provided a test key in-session.
- Desired language via `languageConfig`, if non-English content is needed.

Use idempotency keys for all POST requests so retries do not create duplicate courses or jobs.

```http
Authorization: Bearer leia_sk_...
Content-Type: application/json
Idempotency-Key: stable-unique-key
```

## Full course creation flow

Use this sequence for creating a complete course via API:

| Step | Endpoint | Purpose |
|---|---|---|
| 1 | `POST /course-creation/parse-description` | Convert prompt/source material into structured course data |
| 2 | `POST /course-creation/curriculum-jobs` | Start async curriculum generation |
| 3 | `GET /course-creation/curriculum-jobs/:jobId` | Poll until curriculum is `COMPLETED` |
| 4 | Review/edit curriculum | Important human/agent checkpoint before course creation |
| 5 | `POST /courses` | Create the course from curated curriculum |
| 6 | `POST /courses/:courseId/lessons/generate-all` | Batch generate lesson content |
| 7 | `GET /jobs/:jobId` or `GET /courses/:courseId/jobs` | Poll generation status |
| 8 | Optional: `POST /courses/:courseId/lessons/generate-slides` | Batch generate slides |
| 9 | Optional: `POST /courses/:courseId/lessons/generate-videos` | Export videos after slides are ready |

## Curriculum review checkpoint

Generated curricula can overshoot requested length. Always inspect the curriculum before `POST /courses`.

Check:

- Module count and lesson count match the user request.
- Lesson titles are in the requested language or acceptable bilingual form.
- Lessons have stable slugs.
- Lesson `type` values are supported (`LECTURE`, `QUIZ`, `PROJECT`, etc.).
- The course has enough coverage without ballooning into too many lessons.

If the generated curriculum is too large, curate it manually before creating the course. It is normal to select a subset of modules/lessons or rewrite the curriculum into a compact structure.

## Language configuration

For non-English courses, include `languageConfig` consistently in parse, curriculum, course creation, and lesson/slides generation requests.

```json
{
  "languageConfig": {
    "contentLanguage": "ko",
    "tutorLanguage": "ko",
    "supportedLanguages": ["ko", "en"],
    "culturalContext": "Korean workplace training"
  }
}
```

Use ISO-style language codes where possible:

- Korean: `ko`
- Burmese/Myanmar: `my`
- Japanese: `ja`
- English: `en`

## Required curriculum generation fields

When calling `POST /course-creation/curriculum-jobs`, include these fields inside `instructions`; the backend expects them even if docs/examples sometimes omit them:

```json
{
  "instructions": {
    "courseTitle": "...",
    "targetAudience": "...",
    "difficulty": "beginner",
    "duration": "12 hours",
    "focusAreas": ["..."],
    "learningObjectives": ["..."],
    "tone": "conversational",
    "includeExercises": true,
    "includeQuizzes": true,
    "includeProjects": false
  }
}
```

Avoid empty arrays for `focusAreas` or `learningObjectives`; provide sensible fallbacks if parsing returns none.

## Polling async jobs

Use bounded polling with clear status output.

Statuses to handle:

- `QUEUED`
- `PROCESSING`
- `COMPLETED`
- `FAILED`
- `RETRYING`

Stop polling immediately on `FAILED` and print the normalized error reason if present. Do not mark work complete if any job failed.

For curriculum jobs, poll:

```http
GET /course-creation/curriculum-jobs/:jobId
```

For regular jobs, poll:

```http
GET /jobs/:jobId
```

## Batch lesson content generation

After `POST /courses` returns `lessonIds`, prefer the batch endpoint:

```http
POST /courses/:courseId/lessons/generate-all
```

Body:

```json
{
  "lessonIds": ["lesson_1", "lesson_2"],
  "customInstructions": "Use concise examples and include code snippets.",
  "languageConfig": {
    "contentLanguage": "en",
    "tutorLanguage": "en",
    "supportedLanguages": ["en"]
  }
}
```

Then poll the returned `LESSON_GENERATION` job with `GET /jobs/:jobId`.

## Slides and videos

Slides:

```http
POST /courses/:courseId/lessons/generate-slides
```

Use `nano-banana`; do not pass a `method` field. Choose one template:

- `whiteboard`
- `flat-illustration-corporate`
- `doodle-notebook`
- `handwrittenchalkcasual`

Body:

```json
{
  "lessonIds": ["lesson_1"],
  "options": {
    "template": "whiteboard",
    "slideCount": 6,
    "language": "en"
  }
}
```

Videos:

```http
POST /courses/:courseId/lessons/generate-videos
```

Only request video exports after lessons have `slidesStatus: READY`. Local video export requires the BullMQ worker to be running; otherwise jobs may remain queued.

## Retrieval endpoints

Use these to verify state and debug:

```http
GET /courses/:courseId
GET /jobs/:jobId
GET /courses/:courseId/jobs
GET /courses/:courseId/rag-status
GET /courses/:courseId/video-exports
GET /courses/:courseSlug/lessons/:lessonSlug
GET /openapi.json
```

## Common failure handling

- `400 BAD_REQUEST`: Check required fields, JSON shape, non-empty arrays, and HTTPS source URLs.
- `401 UNAUTHORIZED`: Missing/revoked/malformed API key.
- `403 FORBIDDEN`: API key service user is not valid for the organization or is not a creator.
- `409 IDEMPOTENCY_CONFLICT`: Same `Idempotency-Key` reused with a different body.
- `429 TOO_MANY_REQUESTS`: Usage/rate limit exceeded; ask the user to wait, reset, or upgrade.
- `500 INTERNAL_SERVER_ERROR`: Inspect server logs and job result error fields.

## Output style for users

When running API workflows, report compact progress:

```txt
Parse: completed → draftCourseId=...
Curriculum: completed → 3 modules / 12 lessons
Review: trimmed to 12 lessons
Course: created → courseId=...
Lesson generation: completed → 12/12 lessons
Verification: course has content in requested language
```

Include IDs the user needs to continue:

- `courseId`
- `courseSlug`
- `lessonIds`
- `jobId`

Avoid dumping huge JSON unless the user asks. Summarize and save raw responses to temp files when useful.

## Quick curl skeleton

```bash
API_KEY="leia_sk_..."
BASE_URL="http://localhost:3000/api/v1"

curl -sS \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: course-parse-$(date +%s)" \
  -d '{"prompt":"Create a short TypeScript course"}' \
  "$BASE_URL/course-creation/parse-description"
```
