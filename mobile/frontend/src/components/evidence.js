export async function encodeEvidence(file){
 if(!file||!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>12*1024*1024)throw new Error("Choose a JPEG, PNG or WebP photo under 12 MB.");
 const url=URL.createObjectURL(file),image=new Image();
 try{
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error("The image could not be opened. Choose a different photo."));image.src=url;});
  if(!image.naturalWidth||image.naturalWidth*image.naturalHeight>40000000)throw new Error("This image is too large. Choose a normal photo or screenshot.");
  const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const context=canvas.getContext("2d");context.fillStyle="white";context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  for(const quality of [.88,.76,.64,.52]){const value=canvas.toDataURL("image/jpeg",quality).split(",")[1];if(value.length<=Math.ceil(512*1024/3)*4)return value;}
  throw new Error("This photo is too detailed to upload clearly. Crop to the meter or payment details and retry.");
 }finally{URL.revokeObjectURL(url);}
}
export async function uploadEvidence(ctx,file,purpose){const image=await encodeEvidence(file);return ctx.api("/api/platform/direct-payments/evidence",{method:"POST",body:{purpose,image}});}
export function evidenceImages(ctx){
 const urls=[],listeners=[];let stopped=false;
 async function load(el){
  try{
   const blob=await ctx.api(`/api/platform/direct-payments/evidence/${encodeURIComponent(el.dataset.evidenceId)}`,{response:"blob"});
   if(stopped||!el.isConnected)return;
   const url=URL.createObjectURL(blob);urls.push(url);el.src=url;el.hidden=false;
  }catch{if(!stopped&&el.isConnected){el.alt="Image unavailable — refresh to retry";el.hidden=false;}}
 }
 return {
  async mount(){
   for(const el of document.querySelectorAll("[data-evidence-id]")){
    if(stopped)return;
    const disclosure=el.closest("details[data-defer-evidence]");
    if(disclosure&&!disclosure.open){
     const onOpen=()=>{if(disclosure.open){disclosure.removeEventListener("toggle",onOpen);void load(el);}};
     disclosure.addEventListener("toggle",onOpen);
     listeners.push(()=>disclosure.removeEventListener("toggle",onOpen));
    }else await load(el);
   }
  },
  unmount(){
   stopped=true;
   for(const remove of listeners)remove();
   for(const url of urls)URL.revokeObjectURL(url);
  },
 };
}
