/* KSP-V2 multiplayer integration. Load only after RTDB security rules are deployed. */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {getAuth, signInAnonymously} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {getDatabase, ref, set, onValue, onDisconnect, serverTimestamp} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
const config = {apiKey:"AIzaSyB93v_WO_qGHuYN2qeaI0QIoeKT7gdoWj0",authDomain:"kembara-si-petara.firebaseapp.com",databaseURL:"https://kembara-si-petara-default-rtdb.asia-southeast1.firebasedatabase.app",projectId:"kembara-si-petara",appId:"1:516080734737:web:61492c4996f241dedf57b0"};
const app=initializeApp(config,"ksp-multiplayer");
const auth=getAuth(app), db=getDatabase(app);
let ownRef=null, unsubscribe=null, lastUpdate=0, joined=false;
const others=new Map();
function showStatus(message){
 let el=document.getElementById("multiplayerStatus");
 if(!el){
  el=document.createElement("div");
  el.id="multiplayerStatus";
  el.setAttribute("role","status");
  el.setAttribute("aria-live","polite");
  // Keep player count visible BELOW the HUD on both desktop and mobile.
  el.style.cssText="position:absolute;top:76px;left:50%;transform:translateX(-50%);z-index:155;color:#fff;background:#09283df2;border:2px solid #6ba6b5;box-shadow:0 3px 8px #0006;padding:7px 12px;border-radius:12px;font:800 13px sans-serif;white-space:nowrap;pointer-events:none;text-align:center";
  document.querySelector("#worldViewport")?.append(el);
 }
 el.textContent=message;
}
// Render remote players between Firebase updates instead of jumping to each new position.
let animationId=0, animationTime=0;
function animateRemotePlayers(time){
 const dt=Math.min(80,Math.max(0,time-(animationTime||time)));
 animationTime=time;
 const alpha=1-Math.exp(-dt/95);
 for(const state of others.values()){
  state.x+=(state.targetX-state.x)*alpha;
  state.y+=(state.targetY-state.y)*alpha;
  if(Math.abs(state.targetX-state.x)<0.3)state.x=state.targetX;
  if(Math.abs(state.targetY-state.y)<0.3)state.y=state.targetY;
  state.el.style.left=state.x+"px";
  state.el.style.top=state.y+"px";
  const moving=Math.abs(state.targetX-state.x)>0.4||Math.abs(state.targetY-state.y)>0.4||time-state.lastMotion<230;
  const frame=moving?1+Math.floor(time/145)%4:1;
  const avatarIds=["boy1","boy2","girl1","girl2","teacherM","teacherF"];
  const avatarIndex=avatarIds.indexOf(state.avatar);
  state.img.style.transform=avatarIndex>=0 && moving ? "translateY("+(frame%2?-2:0)+"px)" : "";
  if(avatarIndex>=0) {
   const blank="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
   if(state.img.getAttribute("src")!==blank)state.img.setAttribute("src",blank);
   const directions=["down","up","left","right"];
   const directionIndex=Math.max(0,directions.indexOf(state.direction));
   state.img.style.backgroundImage='url("assets/avatars/approved-explorers-atlas.svg")';
   state.img.style.backgroundRepeat="no-repeat";
   state.img.style.backgroundSize="348px 350px";
   state.img.style.backgroundPosition=(-avatarIndex*58)+"px "+(-(directionIndex+1)*70)+"px";
  } else {
   state.img.style.backgroundImage="";
   const src="assets/player/petara-"+state.direction+"-"+frame+".png";
   if(state.img.getAttribute("src")!==src)state.img.src=src;
  }
 }
 animationId=requestAnimationFrame(animateRemotePlayers);
}
function drawPlayers(snapshot,uid){
 const players=snapshot.val()||{};
 const world=document.getElementById("world");
 if(!world)return;
 for(const [id,p] of Object.entries(players)){
  if(id===uid||!p||typeof p.name!=="string")continue;
  const x=Math.max(0,Math.min(1600,Number(p.x)||0));
  const y=Math.max(0,Math.min(900,Number(p.y)||0));
  let state=others.get(id);
  if(!state){
   const el=document.createElement("div");
   el.className="remote-player";
   el.style.cssText="position:absolute;width:58px;height:76px;transform:translate(-50%,-76%);pointer-events:none;z-index:29;text-align:center;will-change:left,top";
   const label=document.createElement("div");
   label.style.cssText="position:absolute;bottom:70px;left:50%;transform:translateX(-50%);background:#152631e8;color:white;border:2px solid #fff7;border-radius:8px;padding:3px 8px;white-space:nowrap;font:bold 12px sans-serif";
   el.append(label);
   const img=document.createElement("img");
   img.style.cssText="position:absolute;left:0;bottom:0;width:58px;height:70px;object-fit:contain";
   img.alt="";
   el.append(img);
   world.append(el);
   state={el,img,x,y,targetX:x,targetY:y,direction:"down",lastMotion:0};
   others.set(id,state);
  }
  state.el.firstChild.textContent=p.name.slice(0,24);
  state.direction=["up","down","left","right"].includes(p.direction)?p.direction:"down";
  state.avatar=["boy1","boy2","girl1","girl2","teacherM","teacherF"].includes(p.avatar)?p.avatar:"";
  if(state.targetX!==x||state.targetY!==y)state.lastMotion=performance.now();
  state.targetX=x;
  state.targetY=y;
 }
 for(const [id,state] of others){
  if(!players[id]){state.el.remove();others.delete(id);}
 }
 if(!animationId)animationId=requestAnimationFrame(animateRemotePlayers);
 showStatus("👥 "+Object.keys(players).length+"/30 PEMAIN");
}
export async function joinMultiplayer(name, getPosition, selectedAvatar){
 const avatar=["boy1","boy2","girl1","girl2","teacherM","teacherF"].includes(selectedAvatar)?selectedAvatar:"boy1";
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
   try{
    await set(ownRef,{name:String(name).slice(0,24),x:Math.round(p.x),y:Math.round(p.y),direction:p.direction||"down",avatar,updatedAt:serverTimestamp()});
   }catch(e){
    // Compatibility: older RTDB rules may not yet permit the new avatar field.
    // Keep existing multiplayer working until the avatar rule is deployed.
    try{await set(ownRef,{name:String(name).slice(0,24),x:Math.round(p.x),y:Math.round(p.y),direction:p.direction||"down",updatedAt:serverTimestamp()});}
    catch(error){showStatus("Multiplayer belum tersedia");}
   }
  };
  window.__kspMultiplayerUpdate=update;await update();
 }catch(e){showStatus("Multiplayer belum tersedia");}
}
export async function leaveMultiplayer(){joined=false;unsubscribe?.();unsubscribe=null;window.__kspMultiplayerUpdate=null;if(ownRef){try{await set(ownRef,null)}catch(e){}ownRef=null;}for(const state of others.values())state.el.remove();others.clear();if(animationId)cancelAnimationFrame(animationId);animationId=0;animationTime=0;}
