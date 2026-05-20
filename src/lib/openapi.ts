import { createOpenAPI } from 'fumadocs-openapi/server';

const baseOpenapi = createOpenAPI({
  // the OpenAPI schema, you can also give it an external URL.
  input: ['./openapi.json'],
});

function patchDocument(doc: any) {
  if (doc) {
    if (doc.bundled) patchSpec(doc.bundled);
    if (doc.dereferenced) patchSpec(doc.dereferenced);
  }
  return doc;
}

function patchSpec(spec: any) {
  if (spec && spec.paths) {
    const fileProp = spec.paths['/rag-documents']?.post?.requestBody?.content?.['multipart/form-data']?.schema?.properties?.file;
    if (fileProp) {
      fileProp.format = 'binary';
    }
  }
}

export const openapi = {
  ...baseOpenapi,
  async getSchema(document: string) {
    const doc = await baseOpenapi.getSchema(document);
    return patchDocument(doc);
  },
  async getSchemas() {
    const schemas = await baseOpenapi.getSchemas();
    for (const key of Object.keys(schemas)) {
      schemas[key] = patchDocument(schemas[key]);
    }
    return schemas;
  }
};
