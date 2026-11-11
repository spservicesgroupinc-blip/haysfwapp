import { useEffect, useState } from "react";
import { deleteDraft, listDrafts, subscribeDrafts, type RequestDraft } from "../services/requestDrafts";

export default function DraftRecovery({onResume,onRetry,onOpen}: {onResume:(draft:RequestDraft)=>void;onRetry:(draft:RequestDraft)=>void;onOpen:(id:string)=>void}) {
  const [rows,setRows]=useState<RequestDraft[]>([]);
  const [error,setError]=useState("");
  useEffect(()=>{
    let active=true;
    const read=()=>void listDrafts().then(items=>{if(active){setRows(items);setError("");}}).catch(()=>{if(active)setError("Device drafts could not be loaded. Keep any open request form on screen.");});
    read();const unsubscribe=subscribeDrafts(read);window.addEventListener("focus",read);
    return()=>{active=false;unsubscribe();window.removeEventListener("focus",read);};
  },[]);
  if(!rows.length&&!error)return null;
  return <section className="draft-recovery" aria-label="Device drafts">
    <h2>Continue your work <span className="count">{rows.length}</span></h2>
    {error&&<p role="alert">{error}</p>}
    {rows.map(row=><div className="draft-recovery-row" key={row.id}>
      <span><strong>{row.values.selectedJob?.customer||row.values.customerText||"New request"}</strong><small>{row.submission?.linked ? "Submitted · email needs review" : row.submission ? "Submission interrupted · ready to retry" : "Draft saved on this device"}</small></span>
      {row.submission?.linked ? <button className="button" onClick={()=>onOpen(row.submission!.linked!.id)}>Review email</button> : row.submission ? <button className="button" onClick={()=>onRetry(row)}>Retry submission</button> : <button className="button" onClick={()=>onResume(row)}>Resume draft</button>}
      <button className="text-button" onClick={()=>{if(window.confirm(row.submission ? "Remove this device recovery copy? Any request already saved to the shared queue will remain." : "Discard this draft and its device attachments?")) void deleteDraft(row.id).catch(()=>setError("Could not discard the draft. Try again."));}}>Discard</button>
    </div>)}
  </section>;
}
