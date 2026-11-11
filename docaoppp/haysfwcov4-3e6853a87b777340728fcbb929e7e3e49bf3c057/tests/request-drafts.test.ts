import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequest } from "../src/services/requests";
import { readDraft, saveDraft, listDrafts, deleteDraft, type RequestDraft } from "../src/services/requestDrafts";
import { queueDraftSubmission, runDraftSubmission, type SubmissionApi } from "../src/services/durableSubmission";

function draft(id: string, scope = "test-backend"): RequestDraft {
  return { id, scope, updatedAt: new Date().toISOString(), values: { customerText: "York", selectedJob: null, note: "Replace insulation", customerCredits: false, amount: "", amountSign: "+", emailAddress: "", photos: [{ id: "p1", name: "marked.jpg", type: "image/jpeg", lastModified: 1, edited: true, blob: new Blob(["marked bytes"], {type:"image/jpeg"}) }], pdf: {name:"quote.pdf", type:"application/pdf", lastModified:2, blob:new Blob(["pdf bytes"])} } };
}
test("drafts preserve attachment bytes and isolate backend data", async () => {
  const row = draft("scope-test"); await saveDraft(row);
  await saveDraft({...draft(row.id, "other-backend"), values:{...row.values,note:"Other"}});
  assert.equal((await readDraft(row.id,row.scope))?.values.note,"Replace insulation");
  assert.equal(await (await readDraft(row.id,row.scope))?.values.photos[0].blob.text(),"marked bytes");
  assert.equal((await listDrafts("other-backend")).find(x=>x.id===row.id)?.values.note,"Other");
  await deleteDraft(row.id,row.scope); assert.equal(await readDraft(row.id,row.scope),undefined);
  assert.ok(await readDraft(row.id,"other-backend"));
});
test("interrupted uploads reuse identities and confirmed save steps", async () => {
  const row=draft("upload-retry"); await saveDraft(row);
  const request=createRequest();request.job.customer="York";
  await queueDraftSubmission(row,request);
  const prepared=(await readDraft(row.id,row.scope))!;
  for(const file of prepared.submission!.uploads) file.prepared={name:file.source.name,mimeType:file.source.type,size:file.source.blob.size,kind:file.kind,data:"dGVzdA=="};
  await saveDraft(prepared);
  let saves=0,fail=true; const ids:string[]=[];
  const api:SubmissionApi={
    save:async(r)=>({...r,revision:++saves}),
    upload:async(_id,file,attachmentId,mutationId)=>{ids.push(attachmentId+mutationId);if(fail){fail=false;throw new Error("Lost upload response");}return {id:attachmentId,name:file.name,mimeType:file.mimeType,size:file.size,kind:file.kind} as any;},
    email:async()=>{throw new Error("Unexpected email");}
  };
  await assert.rejects(runDraftSubmission(row.id,row.scope,api),/Lost upload/);
  assert.equal(saves,1);
  await runDraftSubmission(row.id,row.scope,api);
  assert.equal(ids[0],ids[1]);assert.equal(saves,2);
  assert.equal(await readDraft(row.id,row.scope),undefined);
});
test("confirmed submission survives uncertain email and email is never repeated automatically",async()=>{
  const row=draft("email-recovery");row.values.emailAddress="pm@example.com";row.values.photos=[];row.values.pdf=null;await saveDraft(row);
  const request=createRequest();request.job.customer="York";await queueDraftSubmission(row,request);
  let emails=0;
  const api:SubmissionApi={save:async r=>({...r,revision:1}),upload:async()=>{throw new Error("Unexpected upload")},email:async()=>{emails++;throw new Error("Response lost")}};
  assert.match(await runDraftSubmission(row.id,row.scope,api),/email/i);
  assert.ok((await readDraft(row.id,row.scope))?.submission?.linked);
  await runDraftSubmission(row.id,row.scope,api);assert.equal(emails,1);
});
test("storage failure rejects the draft save",async()=>{
  const original=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(){throw new Error("Storage full");};
  try{await assert.rejects(saveDraft(draft("quota")),/Storage full/);}finally{IDBDatabase.prototype.transaction=original;}
});
