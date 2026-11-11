import { useEffect, useRef, useState } from "react";
import { API_URL } from "../services/storage";
import { saveDraft, type DraftValues, type RequestDraft } from "../services/requestDrafts";

export function useRequestDraft(id: string, values: DraftValues, frozen: React.MutableRefObject<boolean>, onLeaveGuard?: (guard:(()=>boolean)|null)=>void) {
  const [status,setStatus]=useState("Draft not started");
  const [error,setError]=useState("");
  const writes=useRef(Promise.resolve());
  const saving=useRef(false);
  const failed=useRef(false);
  const mounted=useRef(true);
  const latest=useRef(values);latest.current=values;
  const persist=() => {
    const row:RequestDraft={id,scope:API_URL,updatedAt:new Date().toISOString(),values:latest.current};
    saving.current=true;
    if(mounted.current)setStatus("Saving draft…");
    const task=writes.current.catch(()=>undefined).then(()=>saveDraft(row));
    writes.current=task;
    void task.then(()=>{if(writes.current===task){saving.current=false;failed.current=false;if(mounted.current){setStatus("Draft saved on this device");setError("");}}}).catch(e=>{saving.current=false;failed.current=true;if(mounted.current){setError(e instanceof Error?e.message:"Draft could not be saved.");setStatus("Draft not saved · keep this page open");}});
    return task.then(()=>row);
  };
  useEffect(()=>{
    if(frozen.current)return;
    if(!(values.customerText||values.note||values.photos.length||values.pdf||values.amount||values.emailAddress||values.requestType||values.customerCredits))return;
    void persist().catch(()=>undefined);
  },[id,values.customerText,values.selectedJob,values.note,values.photos,values.pdf,values.amount,values.amountSign,values.emailAddress,values.requestType,values.customerCredits]);
  useEffect(()=>{
    mounted.current=true;
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(saving.current||failed.current){event.preventDefault();event.returnValue="";}};
    window.addEventListener("beforeunload",beforeUnload);
    onLeaveGuard?.(()=>!failed.current||window.confirm("This draft has not been saved on the device. Leave and lose these changes?"));
    return()=>{mounted.current=false;window.removeEventListener("beforeunload",beforeUnload);onLeaveGuard?.(null);};
  },[onLeaveGuard]);
  return {status,error,persist};
}
