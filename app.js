const STORAGE_KEY = "peiMutualResidentialRentalInspection_v2";
const qs=s=>document.querySelector(s), qsa=s=>[...document.querySelectorAll(s)];

function createInspectionItem(title, guidance=""){
  const node=qs("#inspectionItemTemplate").content.cloneNode(true);
  const article=node.querySelector(".inspection-item");
  node.querySelector(".item-title").textContent=title;
  if(guidance){
    const b=node.querySelector(".mini-guidance-button"), p=node.querySelector(".item-guidance");
    b.classList.remove("hidden"); p.textContent=guidance; b.addEventListener("click",()=>p.classList.toggle("hidden"));
  }
  const buttons=[...node.querySelectorAll(".status-buttons button")], details=node.querySelector(".deficiency-details");
  buttons.forEach(btn=>btn.addEventListener("click",()=>{
    buttons.forEach(x=>x.classList.remove("selected")); btn.classList.add("selected"); article.dataset.status=btn.dataset.status;
    details.classList.toggle("hidden",!["D","IC","R"].includes(btn.dataset.status)); scheduleAutosave();
  }));
  const input=node.querySelector(".photo-input"), preview=node.querySelector(".photo-preview"), remove=node.querySelector(".remove-photo");
  input.addEventListener("change",()=>{
    const f=input.files?.[0]; if(!f)return;
    if(article.dataset.photoUrl)URL.revokeObjectURL(article.dataset.photoUrl);
    const url=URL.createObjectURL(f); article.dataset.photoUrl=url; preview.innerHTML="";
    const img=document.createElement("img"); img.src=url; preview.appendChild(img); remove.classList.remove("hidden");
  });
  remove.addEventListener("click",()=>{
    if(article.dataset.photoUrl)URL.revokeObjectURL(article.dataset.photoUrl);
    delete article.dataset.photoUrl; input.value=""; preview.innerHTML=""; remove.classList.add("hidden");
  });
  node.querySelector(".observation").addEventListener("input",scheduleAutosave);
  return node;
}

function makeSection(s){
  const el=document.createElement("section"); el.className="inspection-section";
  el.innerHTML=`<button class="section-header" type="button"><span>${s.number}. ${s.title}</span><span class="section-arrow">▶</span></button><div class="section-content collapsed"></div>`;
  const c=el.querySelector(".section-content");
  if(s.guidance){const d=document.createElement("details");d.className="guidance";d.innerHTML=`<summary>Inspector Guidance</summary><p>${s.guidance}</p>`;c.appendChild(d);}
  const target=document.createElement("div"); c.appendChild(target);
  s.items.forEach(i=>target.appendChild(createInspectionItem(i)));
  return el;
}

function build(){
  inspectionSectionsBeforeFire.forEach(s=>qs("#generatedSections").appendChild(makeSection(s)));
  Object.entries(fireItems).forEach(([k,arr])=>{const t=qs(`[data-items="${k}"]`);arr.forEach(i=>t.appendChild(createInspectionItem(i)));});
  inspectionSectionsAfterFire.forEach(s=>qs("#generatedSectionsAfterFire").appendChild(makeSection(s)));
}

function wireSections(){
  qsa(".section-header").forEach(h=>h.addEventListener("click",()=>{
    const c=h.closest(".inspection-section").querySelector(".section-content"); c.classList.toggle("collapsed");
    h.querySelector(".section-arrow").textContent=c.classList.contains("collapsed")?"▶":"▼";
  }));
}

function updateCrawl(){
  const on=qs("#crawlSpace").checked; qs("#crawlSpaceDetails").classList.toggle("hidden",!on); if(!on)return;
  const st={height:qs("#crawlHeight").value,occupied:qs("#crawlOccupied").checked,flue:qs("#crawlFlue").checked,plenum:qs("#crawlPlenum").checked};
  const a=qs("#crawlAlert");
  if(inspectionRules.crawlSpace.reviewSuggested(st)){a.className="rule-alert warning";a.innerHTML="<strong>Further classification/code review may be appropriate.</strong> One or more observed characteristics affect how the space may be treated for Code purposes.";a.classList.remove("hidden");}
  else if(st.height){a.className="rule-alert ok";a.textContent="No automatic review trigger identified by this screening rule.";a.classList.remove("hidden");}
  else a.classList.add("hidden");
}

function updateAlarm(){
  const s=qs("#storeys").value,u=qs("#dwellingUnits").value,b=qs("#fireAlarmRule");
  if(!s||!u){b.className="rule-alert neutral";b.textContent="Enter storeys and dwelling units in Section 1.";return;}
  if(inspectionRules.fireAlarm.generalTrigger({storeys:s,dwellingUnits:u})){b.className="rule-alert warning";b.innerHTML=`<strong>General fire-alarm trigger identified.</strong> ${s} storey(s), ${u} dwelling unit(s). The screening trigger is 4+ storeys OR more than 11 units. Exceptions may apply; use R if the requirement cannot be established.`;}
  else{b.className="rule-alert ok";b.innerHTML=`<strong>General size/storey trigger not identified.</strong> ${s} storey(s), ${u} dwelling unit(s). Other conditions can still affect requirements.`;}
}

function updateCO(){
  const any=qsa(".co-source").some(x=>x.checked),b=qs("#coMessage");
  b.className=any?"rule-alert warning":"rule-alert neutral";
  b.textContent=any?"Potential CO source / communicating garage selected. Confirm the applicable CO detection arrangement.":"No potential CO source selected yet.";
}

function serialize(){
  const fields={};
  qsa("input,textarea,select").forEach((el,i)=>{
    if(el.type==="file")return; const k=el.id||el.name||`field_${i}`;
    if(el.type==="checkbox"||el.type==="radio")fields[k+"_"+i]=el.checked; else fields[k]=el.value;
  });
  const items=qsa(".inspection-item").map((el,i)=>({i,status:el.dataset.status||"",observation:el.querySelector(".observation")?.value||""}));
  return {fields,items};
}
function save(show=true){localStorage.setItem(STORAGE_KEY,JSON.stringify(serialize())); if(show){const n=qs("#saveNotice");n.classList.remove("hidden");setTimeout(()=>n.classList.add("hidden"),1500);}}
let timer; function scheduleAutosave(){clearTimeout(timer);timer=setTimeout(()=>save(false),500);}
function load(){
  const raw=localStorage.getItem(STORAGE_KEY); if(!raw)return;
  try{
    const d=JSON.parse(raw),els=qsa("input,textarea,select");
    els.forEach((el,i)=>{if(el.type==="file")return;const k=el.id||el.name||`field_${i}`;if(el.type==="checkbox"||el.type==="radio"){const v=d.fields[k+"_"+i];if(typeof v==="boolean")el.checked=v;}else if(k in d.fields)el.value=d.fields[k];});
    qsa(".inspection-item").forEach((el,i)=>{const it=d.items?.find(x=>x.i===i);if(!it)return;if(it.status){el.dataset.status=it.status;el.querySelector(`[data-status="${it.status}"]`)?.classList.add("selected");if(["D","IC","R"].includes(it.status))el.querySelector(".deficiency-details")?.classList.remove("hidden");}const o=el.querySelector(".observation");if(o)o.value=it.observation||"";});
  }catch(e){console.warn(e);}
}
function wireInputs(){
  qsa("input:not([type=file]),textarea,select").forEach(el=>{el.addEventListener("input",scheduleAutosave);el.addEventListener("change",scheduleAutosave);});
  ["#crawlSpace","#crawlHeight","#crawlOccupied","#crawlFlue","#crawlPlenum"].forEach(s=>qs(s)?.addEventListener("change",updateCrawl));
  ["#storeys","#dwellingUnits"].forEach(s=>qs(s)?.addEventListener("input",updateAlarm));
  qsa(".co-source").forEach(e=>e.addEventListener("change",updateCO));
  qs("#standardsToggle").addEventListener("click",()=>qs("#standardsPanel").classList.toggle("hidden"));
  qs("#saveInspection").addEventListener("click",()=>save(true));
  qs("#newInspection").addEventListener("click",()=>{if(confirm("Start a new inspection? This clears the saved inspection on this device.")){localStorage.removeItem(STORAGE_KEY);location.reload();}});
}
build(); wireSections(); load(); wireInputs(); updateCrawl(); updateAlarm(); updateCO();
