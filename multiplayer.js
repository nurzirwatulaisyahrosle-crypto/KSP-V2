/* KSP-V2 multiplayer integration. Load only after RTDB security rules are deployed. */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {getAuth, signInAnonymously} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {getDatabase, ref, set, onValue, onDisconnect, serverTimestamp} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
const config = {apiKey:"AIzaSyB93v_WO_qGHuYN2qeaI0QIoeKT7gdoWj0",authDomain:"kembara-si-petara.firebaseapp.com",databaseURL:"https://kembara-si-petara-default-rtdb.asia-southeast1.firebasedatabase.app",projectId:"kembara-si-petara",appId:"1:516080734737:web:61492c4996f241dedf57b0"};
const app=initializeApp(config,"ksp-multiplayer");
const auth=getAuth(app), db=getDatabase(app);
let ownRef=null, unsubscribe=null, lastUpdate=0, joined=false;
const others=new Map();
function showStatus(message){let el=document.getElementById("multiplayerStatus");if(!el){el=document.createElement("div");el.id="multiplayerStatus";el.style.cssText="position:absolute;top:8px;right:10px;z-index:100;color:white;background:#152631dd;padding:5px 10px;border-radius:9px;font:700 12px sans-serif";document.querySelector("#gameScreen")?.append(el);}el.textContent=message;}
function drawPlayers(snapshot,uid){
 const players=snapshot.val()||{}; const world=document.getElementById("world");if(!world)return;
 for(const [id,p] of Object.entries(players)){
  if(id===uid||!p||typeof p.name!=="string")continue;
  let el=others.get(id);
  if(!el){el=document.createElement("div");el.className="remote-player";el.style.cssText="position:absolute;width:58px;height:76px;transform:translate(-50%,-76%);pointer-events:none;z-index:29;text-align:center";
    const label=document.createElement("div");label.style.cssText="position:absolute;bottom:70px;left:50%;transform:translateX(-50%);background:#152631e8;color:white;border:2px solid #fff7;border-radius:8px;padding:3px 8px;white-space:nowrap;font:bold 12px sans-serif";el.append(label);
    const sprite=document.createElement("img");sprite.style.cssText="position:absolute;left:0;bottom:0;width:58px;height:70px;object-fit:contain";el.append(sprite);world.append(el);others.set(id,el);
  }
  el.firstChild.textContent=p.name.slice(0,24);
  const spriteUrl="assets/player/petara-"+(["up","down","left","right"].includes(p.direction)?p.direction:"down")+"-1.png";if(el.lastChild.getAttribute("src")!==spriteUrl)el.lastChild.src=spriteUrl;
  el.style.left=Math.max(0,Math.min(1600,Number(p.x)||0))+"px";el.style.top=Math.max(0,Math.min(900,Number(p.y)||0))+"px";
 }
 for(const [id,el] of others){if(!players[id]){el.remove();others.delete(id);}}
 showStatus("👥 "+Object.keys(players).length+"/30 pemain");
}
export async function joinMultiplayer(name, getPosition){
 if(joined)return;
 try{
  const user=(await signInAnonymously(auth)).user;
  const playersRef=ref(db,"rooms/kelas/players");
  const current=await new Promise((resolve,reject)=>onValue(playersRef,s=>resolve(s.val()||{}),reject,{onlyOnce:true}));
  if(Object.keys(current).length>=30&&!current[user.uid]){showStatus("Bilik penuh (30 pemain)");return;}
  ownRef=ref(db,"rooms/kelas/players/"+user.uid);
  await onDisconnect(ownRef).remove();
  unsubscribe=onValue(playersRef,s=>drawPlayers(s,user.uid),()=>showStatus("Sambungan multiplayer terganggu"));
  joined=true;
  const update=async()=>{if(!joined)return;const p=getPosition();if(!p)return;const now=Date.now();if(now-lastUpdate<180)return;lastUpdate=now;
   try{await set(ownRef,{name:String(name).slice(0,24),x:Math.round(p.x),y:Math.round(p.y),direction:p.direction||"down",updatedAt:serverTimestamp()});}catch(e){showStatus("Multiplayer belum tersedia");}
  };
  window.__kspMultiplayerUpdate=update;await update();
 }catch(e){showStatus("Multiplayer belum tersedia");}
}
export async function leaveMultiplayer(){joined=false;unsubscribe?.();unsubscribe=null;window.__kspMultiplayerUpdate=null;if(ownRef){try{await set(ownRef,null)}catch(e){}ownRef=null;}for(const el of others.values())el.remove();others.clear();}
