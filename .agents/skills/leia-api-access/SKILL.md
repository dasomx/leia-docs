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
| 9 | Rare: `POST /courses/:courseId/lessons/generate-videos` | Re-export videos after manual slide edits (auto-generated otherwise) |
| 10 | Optional: `POST /courses/:courseId/pdf-exports` | Export lessons as PDF |

## PDF-based course creation (RAG upload flow)

When you have source documents (PDFs, DOCX, TXT, etc.) and want the AI to generate a course from them, upload the documents first via the RAG pipeline. The uploaded content becomes reference material for curriculum generation and lesson content.

### RAG upload flow

**Every step must carry the same `draftCourseId`** for documents to end up associated with the final course. Missing the ID at any step breaks the chain.

| Step | Endpoint | Key detail |
|---|---|---|
| R1 | `POST /rag-documents` | Upload document → returns `draftCourseId` (and `courseId: null` — expected, no course exists yet) |
| R2 | `GET /course-creation/drafts/:draftCourseId/rag-status` | Poll until all documents `COMPLETED` |
| R3 | `POST /course-creation/parse-description` | Pass `draftCourseId` so RAG docs inform course structure |
| R4 | `POST /course-creation/curriculum-jobs` | Standard curriculum generation |
| R5 | `POST /courses` | **⚠️ Pass `draftCourseId` here** — this is what creates the course with that ID and auto-links all draft documents to it |

The `draftCourseId` becomes the `courseId`. On `POST /courses`, the server:
1. Creates the course using the `draftCourseId` as the course ID
2. Auto-claims all files, documents, and deep research with that `draftCourseId` — setting their `courseId` to the new course and clearing their `draftCourseId`

### R1: Upload a source document

```http
POST /rag-documents
Content-Type: multipart/form-data
```

This is a **multipart upload**, not JSON. Use `-F` flags in curl:

```bash
curl -s -X POST "$BASE_URL/rag-documents" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Idempotency-Key: upload-source-001" \
  -F "file=@source.pdf" \
  -F "displayName=Course reference material"
```

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | file | **Yes** | Source document, 100MB max |
| `displayName` | string | No | Human-readable file name |
| `courseId` | string | No | Existing course ID to attach to |
| `draftCourseId` | string | No | Draft ID; if neither `courseId` nor `draftCourseId` is provided, a new `draftCourseId` is returned |

Supported types: PDF, DOC/DOCX, XLS/XLSX, TXT, Markdown, HTML, CSV, RTF, and other `text/*` files.

**⚠️ Idempotency for RAG uploads:** Scoped to full upload metadata + file checksum. Reusing the same `Idempotency-Key` with different file content returns `409 IDEMPOTENCY_CONFLICT`.

**Response:**

```json
{
  "fileId": "file_...",
  "documentId": "doc_...",
  "fileName": "source.pdf",
  "mimeType": "application/pdf",
  "fileSize": 123456,
  "publicUrl": "https://...",
  "status": "PENDING",
  "courseId": null,
  "draftCourseId": "550e8400-..."
}
```

**`courseId: null` is expected.** No course exists yet — the document is attached to a draft. It will be auto-linked when you create the course with this `draftCourseId` in step R5.

**Critical:** Save and reuse the same `draftCourseId` through every subsequent step. This is the key that links everything together.

### R2: Poll draft RAG processing status

Documents are processed asynchronously. Wait until all documents complete before proceeding.

```http
GET /course-creation/drafts/:draftCourseId/rag-status
```

**Response:**

```json
{
  "isProcessing": true,
  "totalDocuments": 2,
  "completedCount": 1,
  "failedCount": 0,
  "processingDocuments": [
    { "id": "doc_...", "fileName": "source.pdf", "status": "PROCESSING" }
  ]
}
```

Wait until `isProcessing` is `false` and all documents are `COMPLETED`. If any document `FAILED`, check the document status before continuing.

### R3: Parse with draftCourseId

Pass the `draftCourseId` so uploaded documents inform the course structure:

```json
{
  "prompt": "Create a course from the uploaded reference material...",
  "draftCourseId": "550e8400-..."
}
```

### R4: Generate curriculum

Standard curriculum generation (no `draftCourseId` needed here — the parse already seeded the context):

```http
POST /course-creation/curriculum-jobs
```

### R5: Create course with draftCourseId (the critical link)

```http
POST /courses
```

**This is where documents get associated.** Pass the same `draftCourseId` — the server will:

1. Create the course using that ID as the `courseId`
2. Auto-claim all files and documents with that `draftCourseId`, linking them to the new course

```json
{
  "title": "Course Title",
  "description": "Course description",
  "draftCourseId": "550e8400-...",
  "curriculum": { "modules": [...] },
  "languageConfig": { "contentLanguage": "en", "tutorLanguage": "en", "supportedLanguages": ["en"] }
}
```

After this call, the course exists with `id === draftCourseId`, and all uploaded documents now have that `courseId`.

### Course-level RAG status (verify association)

After course creation, verify documents are linked:

```http
GET /courses/:courseId/rag-status
```

Same response shape as draft RAG status. Use this before triggering lesson generation — lessons benefit from fully processed reference documents.

### Uploading multiple documents

Upload each document separately. All uploads sharing the same `draftCourseId` (or returning the same auto-generated one) will be pooled together:

```bash
# First upload (auto-creates draftCourseId)
RESP=$(curl -s -X POST "$BASE_URL/rag-documents" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@chapter1.pdf")
DRAFT_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['draftCourseId'])")

# Subsequent uploads reuse the same draftCourseId
curl -s -X POST "$BASE_URL/rag-documents" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@chapter2.pdf" \
  -F "draftCourseId=$DRAFT_ID"
```

## Step 1: Parse description

```http
POST /course-creation/parse-description
```

### Request

```json
{
  "prompt": "Create a short course on TypeScript generics for intermediate developers. Cover generic functions, constraints, conditional types, and mapped types. Include practical code examples.",
  "sourceFileUrl": null,
  "pdfUrl": null,
  "files": [],
  "draftCourseId": null
}
```

`prompt` is a natural-language course description. Aim for 3-8 sentences covering topic, audience, key areas, and desired tone/length.

If using uploaded RAG documents, pass the `draftCourseId` from the upload response. You may also pass `sourceFileUrl` or `pdfUrl` (HTTPS URLs only) directly to reference remote source material.

### Actual response shape

The response is wrapped — the parsed course data lives under `data`:

```json
{
  "success": true,
  "data": {
    "title": "Mastering TypeScript Generics",
    "slug": "mastering-typescript-generics",
    "description": "A hands-on course covering generic functions...",
    "targetAudience": "Intermediate TypeScript developers",
    "difficulty": "intermediate",
    "duration": "4-6 weeks",
    "focusAreas": ["Generic Functions", "Type Constraints", "..."],
    "learningObjectives": ["Write reusable generic functions", "..."],
    "tone": "conversational",
    "includeExercises": true,
    "includeQuizzes": true,
    "includeProjects": false,
    "includeAssignment": false,
    "lessonType": "LECTURE",
    "lessonLength": "MEDIUM",
    "contentLevel": "PROFESSIONAL",
    "contentLanguage": "en",
    "tutorLanguage": "en",
    "supportedLanguages": ["en"],
    "customInstructions": "Create 3 modules with 2-3 lessons each."
  },
  "message": "Course description parsed successfully",
  "newCourseCreationId": "550e8400-e29b-41d4-a716-446655440000",
  "researchContext": null
}
```

Key fields to extract:

| Field | Path | Used in |
|---|---|---|
| Parsed course data | `.data` | Pass to curriculum job instructions |
| Draft course ID | `.newCourseCreationId` | Optional: attach RAG docs before course creation |

When the parse result is sparse (e.g., missing `focusAreas` or `learningObjectives`), provide sensible defaults — never pass empty arrays to the curriculum job.

## Step 2: Start curriculum generation

```http
POST /course-creation/curriculum-jobs
```

### Required fields (every field in `instructions` is required)

The backend validates all of these. Missing any returns `400 BAD_REQUEST`:

```json
{
  "instructions": {
    "courseTitle": "string (required)",
    "targetAudience": "string (required)",
    "difficulty": "beginner | intermediate | advanced (required)",
    "duration": "string (required, e.g. '4-6 weeks', '8 hours')",
    "focusAreas": ["string", "..."],
    "learningObjectives": ["string", "..."],
    "tone": "formal | casual | conversational (required)",
    "includeExercises": true,
    "includeQuizzes": true,
    "includeProjects": false,
    "customInstructions": "Create N modules with M-N lessons each. Keep it practical."
  },
  "languageConfig": {
    "contentLanguage": "en",
    "tutorLanguage": "en",
    "supportedLanguages": ["en"],
    "culturalContext": ""
  },
  "sourceFileUrl": null,
  "enableResearch": false
}
```

- `sourceFileUrl` (optional, HTTPS only): Remote file URL to use as source material for curriculum generation. Mutually independent from RAG-uploaded documents — both can inform generation.
- `enableResearch` (optional): Enable the deep research agent for richer curriculum context.

**Critical rules for `instructions`:**

| Field | Type | Valid values | Notes |
|---|---|---|---|
| `difficulty` | string enum | `"beginner"`, `"intermediate"`, `"advanced"` | Required. Pick from parse result or default to `"intermediate"`. |
| `duration` | string | Any non-empty string | Required. Use parse result, or `"4-6 weeks"` as default. |
| `tone` | string enum | `"formal"`, `"casual"`, `"conversational"` | Required. Use parse result, or `"conversational"` as default. |
| `includeExercises` | boolean | `true`/`false` | Required. |
| `includeQuizzes` | boolean | `true`/`false` | Required. |
| `includeProjects` | boolean | `true`/`false` | Required. |
| `courseTitle` | string | Non-empty | Required. |
| `targetAudience` | string | Non-empty | Required. |
| `focusAreas` | string[] | At least 1 entry | Avoid empty array. |
| `learningObjectives` | string[] | At least 1 entry | Avoid empty array. |
| `customInstructions` | string | Any | Optional but strongly recommended. Controls module count and lesson density. |

Use `customInstructions` to steer curriculum size: `"Create 4 modules with 2-3 lessons each. Keep lessons focused and hands-on."` — without this, the generator may produce 8+ modules with 4+ lessons each.

### Response

```json
{
  "jobId": "cmp...",
  "newCourseCreationId": "uuid..."
}
```

## Step 3: Poll curriculum job

```http
GET /course-creation/curriculum-jobs/:jobId
```

### Response (when COMPLETED)

The curriculum lives under `.result.modules[]`:

```json
{
  "status": "COMPLETED",
  "phase": "COMPLETED",
  "progress": 100,
  "errorReason": null,
  "result": {
    "modules": [
      {
        "id": "module-1-foundations",
        "title": "Foundations of AI Agents",
        "description": "Introduces core concepts...",
        "estimatedDuration": 120,
        "lessons": [
          {
            "id": "lesson-1-1-understanding-agents",
            "type": "LECTURE",
            "title": "Understanding AI Agents",
            "slug": "understanding-ai-agents",
            "description": "Explore the definition...",
            "contentLevel": "PROFESSIONAL",
            "lessonLength": "MEDIUM",
            "estimatedDuration": 45,
            "contentType": "reading",
            "learningOutcomes": ["..."],
            "keyTerms": ["..."]
          }
        ]
      }
    ],
    "metadata": {
      "title": "...",
      "difficulty": "intermediate",
      "description": "...",
      "targetAudience": "...",
      "learningObjectives": ["..."],
      "estimatedTotalHours": 10,
      "tags": ["..."]
    }
  },
  "createdAt": "...",
  "completedAt": "..."
}
```

### Polling script pattern

Use a bounded loop with clear progress output:

```bash
JOB_ID="cmp..."
API_KEY="leia_sk_..."
MAX_POLLS=20

for i in $(seq 1 $MAX_POLLS); do
  RESP=$(curl -s "$BASE_URL/course-creation/curriculum-jobs/$JOB_ID" \
    -H "Authorization: Bearer $API_KEY")
  STATUS=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','UNKNOWN'))" 2>/dev/null)
  PROGRESS=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('progress',0))" 2>/dev/null)
  echo "[$i/$MAX_POLLS] Status: $STATUS | Progress: $PROGRESS%"

  if [ "$STATUS" = "COMPLETED" ] || [ "$STATUS" = "FAILED" ]; then
    break
  fi
  sleep 10
done
```

Stop immediately on `FAILED`. Print `errorReason` from the response.

## Step 4: Review and curate the curriculum

This is the most important checkpoint. **Do not skip it.** The AI generator may produce more modules/lessons than requested.

### What to check

1. **Module count**: Does it match the user's request?
2. **Lesson count**: Trim if too many (keep 2-3 per module typically).
3. **Lesson types**: Filter out non-content types if not wanted (e.g., remove `QUIZ` lessons if the user only wants lectures). Note: `generate-all` skips non-AI lesson types automatically.
4. **Lesson slugs**: Every lesson returned by the curriculum job already has a `slug`. Preserve them — they are required when creating the course.
5. **Descriptions**: Verify module and lesson descriptions are present and non-empty.
6. **Content levels**: Ensure `contentLevel` (`PROFESSIONAL`, `INTERMEDIATE`, `BEGINNER`) and `lessonLength` (`SHORT`, `MEDIUM`, `LONG`) are set.

### How to curate

Build a compact curriculum JSON from the generated result, selecting the modules and lessons you want. The format needed by `POST /courses` is:

```json
{
  "modules": [
    {
      "id": "module-1-foundations",
      "title": "Foundations of AI Agents",
      "description": "Introduces core concepts...",
      "lessons": [
        {
          "id": "lesson-1-1-understanding-agents",
          "slug": "understanding-ai-agents",
          "type": "LECTURE",
          "title": "Understanding AI Agents",
          "description": "Explore the definition...",
          "contentLevel": "PROFESSIONAL",
          "lessonLength": "MEDIUM",
          "estimatedDuration": 45
        }
      ]
    }
  ]
}
```

**Every lesson MUST have a `slug`** — this is required by the backend and missing slugs will cause `400 BAD_REQUEST` errors.

## Step 5: Create the course

```http
POST /courses
```

### Required fields

```json
{
  "title": "string (required)",
  "description": "string (recommended, use from parsed data metadata.description)",
  "draftCourseId": "string (REQUIRED for RAG flow — pass the ID from your RAG upload. This becomes the course ID and auto-links all draft documents to the course.)",
  "curriculum": {
    "modules": [
      {
        "id": "string",
        "title": "string",
        "description": "string",
        "lessons": [
          {
            "id": "string (required)",
            "slug": "string (required — use the slug from curriculum job)",
            "type": "string (required, e.g. 'LECTURE')",
            "title": "string (required)",
            "description": "string (recommended)",
            "contentLevel": "string (PROFESSIONAL | INTERMEDIATE | BEGINNER)",
            "lessonLength": "string (SHORT | MEDIUM | LONG)",
            "estimatedDuration": 45
          }
        ]
      }
    ]
  },
  "languageConfig": {
    "contentLanguage": "en",
    "tutorLanguage": "en",
    "supportedLanguages": ["en"]
  }
}
```

### Critical rules

| Field | Required | Notes |
|---|---|---|
| `title` | **Yes** | Course title |
| `description` | Recommended | Pull from `result.metadata.description` in the curriculum response, or craft one from the parsed data |
| **`draftCourseId`** | Required for RAG flow | **If you uploaded RAG documents, pass their `draftCourseId` here.** The course will be created with this ID, and all draft documents/files will be auto-linked. Without this, documents remain orphaned with `courseId: null`. |
| `curriculum.modules[].lessons[].slug` | **Yes** | **Easily missed.** The curriculum job returns slugs — use them verbatim. If missing, derive from the lesson id (kebab-case the last segment). |
| `curriculum.modules[].lessons[].type` | **Yes** | `LECTURE`, `QUIZ`, `PROJECT`, etc. |
| `curriculum.modules[].lessons[].title` | **Yes** | Lesson title |
| `curriculum.modules[].lessons[].description` | Recommended | Lesson summary |
| `curriculum.modules[].lessons[].contentLevel` | Recommended | `PROFESSIONAL`, `INTERMEDIATE`, `BEGINNER` |
| `curriculum.modules[].lessons[].lessonLength` | Recommended | `SHORT`, `MEDIUM`, `LONG` |

### Response

```json
{
  "course": {
    "id": "course_...",
    "title": "...",
    "slug": "...",
    "chapters": [ { "id": "...", "lessons": [{ "id": "lesson_...", ... }] } ]
  },
  "lessonIds": ["lesson_...", "lesson_..."]
}
```

Save `course.id` and `lessonIds[]` — both are needed for subsequent steps.

## Step 6: Batch generate lesson content

```http
POST /courses/:courseId/lessons/generate-all
```

### Request

```json
{
  "lessonIds": ["lesson_1", "lesson_2"],
  "customInstructions": "Use concise explanations with practical Python code examples. Each lesson should be self-contained with clear learning outcomes.",
  "languageConfig": {
    "contentLanguage": "en",
    "tutorLanguage": "en",
    "supportedLanguages": ["en"]
  }
}
```

- `customInstructions` is prepended to each lesson's generation prompt. Keep it focused — language preferences go in `languageConfig`, content instructions go here.
- QUIZ-type lessons in `lessonIds` are automatically skipped by the worker (no error, just excluded from generation count).

### Response

The response is a job object with credit reservation metadata:

```json
{
  "id": "job_...",
  "type": "LESSON_GENERATION",
  "status": "QUEUED",
  "totalLessons": 8,
  "completedLessons": 0,
  "lessonIds": ["lesson_1", "..."],
  "creditReservationId": "f66140f9-...",
  "estimatedCredits": 400,
  "creditFinalizedAt": null,
  "creditRefundedAt": null
}
```

**Credit enforcement is automatic:** The backend reserves credits before enqueueing work. If your organization has insufficient credits, the job creation itself fails with a `403` or tRPC error. The reservation is finalized (unused credits refunded) when the job completes, and fully refunded if the job fails.

### Poll for completion

```http
GET /jobs/:jobId
```

Track `completedLessons` vs `totalLessons` and `progress` (0-100). The `creditFinalizedAt` field may remain null even after completion (finalization happens at the worker level, not always written back to the job record). This is normal — the ledger entries were still created.

## Step 7 & 8: Slides and videos (optional)

### Slides

```http
POST /courses/:courseId/lessons/generate-slides
```

Body:

```json
{
  "lessonIds": ["lesson_1"],
  "options": {
    "template": "flat-illustration-corporate",
    "slideCount": 8,
    "language": "en"
  },
  "languageConfig": {
    "contentLanguage": "en"
  }
}
```

Templates: `whiteboard`, `flat-illustration-corporate`, `doodle-notebook`, `handwrittenchalkcasual`.

**⚠️ Local dev caveat:** Slides generation uses nano-banana for AI image generation. If the nano-banana worker is not running or API keys are not configured for the image service, slides generation returns `500 INTERNAL_SERVER_ERROR` with message `"Failed to start slides generation workflow"`. This is an infrastructure issue, not a credit or auth issue. In production this should work if the worker is deployed.

### Videos

Videos are **auto-generated internally** once presentation/slides generation completes. You do not normally need to trigger them manually.

```http
POST /courses/:courseId/lessons/generate-videos
```

**Only call this endpoint when:** slides have been manually edited after auto-generation, making the auto-generated video stale. In that case, re-trigger video export to sync with the updated slides. Lessons must have `slidesStatus: READY` and the BullMQ video export worker must be running.

## Step 9: PDF exports (optional)

Export course lessons as PDF documents. This is an async operation — trigger the job, then poll for completion.

### Trigger PDF export

```http
POST /courses/:courseId/pdf-exports
```

**Request body:**

```json
{
  "lessonIds": ["lesson_1", "lesson_2"]
}
```

- `lessonIds` (optional): Specific lessons to export. If omitted or empty, exports **all valid lecture lessons** in the course.
- Supports `Idempotency-Key` for safe retries.

**Response:**

```json
{
  "jobId": "job_..."
}
```

### Poll PDF export job

```http
GET /pdf-exports/jobs/:jobId
```

**Response (when COMPLETED):**

```json
{
  "id": "job_...",
  "status": "COMPLETED",
  "progress": 100,
  "result": {
    "downloadUrl": "https://leia-production-exports.s3.amazonaws.com/...",
    "lessonCount": 5,
    "downloadFileName": "course-title-export.zip",
    "downloadKind": "zip"
  },
  "createdAt": "2026-05-20T10:00:00.000Z",
  "completedAt": "2026-05-20T10:05:00.000Z"
}
```

The `result.downloadUrl` is a pre-signed S3 URL — download it to retrieve the exported PDF(s).

### Get PDF export history

```http
GET /courses/:courseId/pdf-exports
```

Returns an array of completed PDF export jobs for the course, each with `downloadUrl`, `lessonCount`, and `downloadFileName`.

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

Use ISO 639-1 codes:

| Language | Code |
|---|---|
| Korean | `ko` |
| Burmese/Myanmar | `my` |
| Japanese | `ja` |
| English | `en` |

## Credit system awareness

Reservation-backed endpoints (`curriculum-jobs`, `generate-all`, `generate-slides`, etc.) automatically:

1. **Reserve** credits before starting AI work.
2. **Block** the request if available credits are insufficient (returns a tRPC `TOO_MANY_REQUESTS` error which the Partner API layer may map to `403 FORBIDDEN`).
3. **Finalize** after work completes — unused reserved credits are refunded.
4. **Refund** fully if the job fails.

You do not need to manage credit reservations manually. The `creditReservationId` and `estimatedCredits` in job responses let you track what was reserved.

For non-reservation endpoints (like `parse-description`), credit enforcement is handled at the tRPC middleware level via `hasCredits()` — the request is allowed if the organization has at least 1 credit available.

## Retrieval endpoints

```http
GET /courses/:courseId
GET /jobs/:jobId
GET /courses/:courseId/jobs
GET /courses/:courseId/rag-status
GET /course-creation/drafts/:draftCourseId/rag-status
GET /courses/:courseId/video-exports
GET /courses/:courseId/pdf-exports
GET /pdf-exports/jobs/:jobId
GET /courses/:courseSlug/lessons/:lessonSlug
GET /openapi.json
```

## Common errors and fixes

### `400 BAD_REQUEST` with Zod validation errors

The response body lists every missing/invalid field as a JSON array. Common causes:

| Symptom | Fix |
|---|---|
| `"difficulty": "Required"` | Add `"difficulty": "intermediate"` to `instructions` |
| `"duration": "Required"` | Add `"duration": "4-6 weeks"` to `instructions` |
| `"tone": "Required"` | Add `"tone": "conversational"` to `instructions` |
| `"includeExercises": "Required"` | Add `"includeExercises": true` to `instructions` |
| `"slug": "Required"` in lessons | Every lesson needs a `slug` field in the curriculum |
| `"lessonIds must be a non-empty array"` | Provide at least one lesson ID |
| `"fileUrl must be an HTTPS URL"` | Source URLs must use `https://`, not `http://` |

### `401 UNAUTHORIZED`
API key is missing, malformed, or revoked. Verify the key starts with `leia_sk_` and is passed as `Authorization: Bearer <key>`.

### `403 FORBIDDEN`
- API key's service user is not a member of the configured organization.
- API key's service user is not a `CREATOR` role user.
- Organization has insufficient credits for the AI operation. Message will say: `"Insufficient credits. Please upgrade your plan..."`

### `409 IDEMPOTENCY_CONFLICT`
Same `Idempotency-Key` reused with a different request body. Use unique keys per unique request.

### `500 INTERNAL_SERVER_ERROR` on slides
Usually means the nano-banana image generation worker is not running or not configured. Check server logs. Not a credit/auth issue.

### `Could not resolve host: api.leia.io`
The production API is not reachable from your network. Use `http://localhost:3000/api/v1` for local development.

## Output style for users

Report compact progress with IDs:

```txt
Parse: ✅ → draftCourseId=550e8400-...
Curriculum: ✅ → 4 modules / 8 lessons (job cmp...)
Course: ✅ → courseId=cmp... (slug: ai-agent-engineering-...)
Lesson gen: ✅ → 8/8 lessons (job cmp...)
  Credit: 400 reserved → finalized
Slides: ⚠️  — nano-banana worker not available locally
```

Include IDs the user needs:

- `courseId` — for all subsequent API calls
- `courseSlug` — for retrieval by slug
- `lessonIds[]` — for targeted generation
- `jobId` — for status polling
- `creditReservationId` — for auditing

Avoid dumping huge JSON unless the user asks. Use `python3 -m json.tool` for readable output when needed, and pipe through `python3 -c` for field extraction.

## Quick curl skeleton

```bash
API_KEY="leia_sk_..."
BASE_URL="http://localhost:3000/api/v1"

# Step 1: Parse description (with optional RAG draftCourseId)
curl -s -X POST "$BASE_URL/course-creation/parse-description" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Create a short course on TypeScript generics for intermediate developers. Cover generic functions, constraints, conditional types, and mapped types with practical code examples.","draftCourseId":null}'

# Optional RAG upload flow:
# Upload a source document
curl -s -X POST "$BASE_URL/rag-documents" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@source.pdf" \
  -F "displayName=Reference material"

# Poll draft RAG processing
curl -s "$BASE_URL/course-creation/drafts/DRAFT_ID/rag-status" \
  -H "Authorization: Bearer $API_KEY"

# Step 2: Start curriculum (use parsed data to fill instructions)
curl -s -X POST "$BASE_URL/course-creation/curriculum-jobs" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instructions": {
      "courseTitle": "Mastering TypeScript Generics",
      "targetAudience": "Intermediate TypeScript developers",
      "difficulty": "intermediate",
      "duration": "3-4 hours",
      "focusAreas": ["Generic Functions", "Constraints", "Conditional Types"],
      "learningObjectives": ["Write reusable generic code"],
      "tone": "conversational",
      "includeExercises": true,
      "includeQuizzes": true,
      "includeProjects": false,
      "customInstructions": "Create 3 modules with 2-3 lessons each."
    },
    "languageConfig": { "contentLanguage": "en", "tutorLanguage": "en", "supportedLanguages": ["en"] }
  }'

# Step 3: Poll curriculum job
curl -s "$BASE_URL/course-creation/curriculum-jobs/JOB_ID" \
  -H "Authorization: Bearer $API_KEY"

# Step 4: Create course with curated curriculum
# IMPORTANT: if using RAG flow, pass draftCourseId here
curl -s -X POST "$BASE_URL/courses" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Course Title",
    "description": "Course description from curriculum metadata",
    "draftCourseId": null,
    "curriculum": { "modules": [...] },
    "languageConfig": { "contentLanguage": "en", "tutorLanguage": "en", "supportedLanguages": ["en"] }
  }'

# Step 5: Generate lessons
curl -s -X POST "$BASE_URL/courses/COURSE_ID/lessons/generate-all" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"lessonIds":["lesson_1","lesson_2"],"customInstructions":"Include code examples.","languageConfig":{"contentLanguage":"en","tutorLanguage":"en","supportedLanguages":["en"]}}'

# Step 6: Poll lesson job
curl -s "$BASE_URL/jobs/JOB_ID" \
  -H "Authorization: Bearer $API_KEY"

# Step 7 (optional): Export PDFs
curl -s -X POST "$BASE_URL/courses/COURSE_ID/pdf-exports" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: pdf-export-001" \
  -d '{"lessonIds":[]}'

# Poll PDF export
curl -s "$BASE_URL/pdf-exports/jobs/JOB_ID" \
  -H "Authorization: Bearer $API_KEY"
```

**API Documentation**: For full request/response schemas, error codes, and field descriptions, refer to the OpenAPI spec at `https://docs.leia.to/llms.txt`.