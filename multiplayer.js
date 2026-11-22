/* KSP-V2 multiplayer integration. Load only after RTDB security rules are deployed. */
import {initializeApp} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {getAuth, signInAnonymously} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {getDatabase, ref, set, onValue, onChildAdded, onChildChanged, onChildRemoved, onDisconnect, serverTimestamp} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
const config = {apiKey:"AIzaSyB93v_WO_qGHuYN2qeaI0QIoeKT7gdoWj0",authDomain:"kembara-si-petara.firebaseapp.com",databaseURL:"https://kembara-si-petara-default-rtdb.asia-southeast1.firebasedatabase.app",projectId:"kembara-si-petara",appId:"1:516080734737:web:61492c4996f241dedf57b0"};
const app=initializeApp(config,"ksp-multiplayer");
const auth=getAuth(app), db=getDatabase(app);
let ownRef=null, unsubscribe=[], lastUpdate=0, lastPosition=null, joined=false;
let ownUid=null, latestPlayers={}, refreshTimer=null, pendingLeave=null, sessionInfo=null;
let lastMapDraw=0, lastPositionSend=0;
const MAX_PLAYERS=100;
const AVATAR_VISIBILITY_RADIUS=250;
const MAX_VISIBLE_REMOTE_AVATARS=24;
const PRESENCE_TIMEOUT_MS=35000;
const POSITION_UPDATE_MS=1000;
const POSITION_CHANGE_UNITS=7;
const HEARTBEAT_MS=12000;
const others=new Map();
function isActivePlayer(p){
 const last=Number(p && p.updatedAt);
 return !!p && typeof p.name==="string" && Number.isFinite(last) &&
   last>0 && Date.now()-last<PRESENCE_TIMEOUT_MS && last-Date.now()<15000;
}
function activePlayers(players){
 return Object.fromEntries(Object.entries(players||{}).filter(([,p])=>isActivePlayer(p)));
}
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
   const blank="data:image/gif;base64,R0lGODlhAQABAIEAAAAAAAAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAgEAAEEBAA7";
   if(state.img.getAttribute("src")!==blank)state.img.setAttribute("src",blank);
   const directions=["down","up","left","right"];
   const directionIndex=Math.max(0,directions.indexOf(state.direction));
   state.img.style.backgroundImage='url("assets/avatars/approved-explorers-atlas.svg")';
   state.img.style.backgroundRepeat="no-repeat";
   state.img.style.backgroundSize="300px 310px";
   state.img.style.backgroundPosition=(-avatarIndex*50)+"px "+(-(directionIndex+1)*62)+"px";
  } else {
   state.img.style.backgroundImage="";
   const src="assets/player/petara-"+state.direction+"-"+frame+".png";
   if(state.img.getAttribute("src")!==src)state.img.src=src;
  }
 }
 animationId=requestAnimationFrame(animateRemotePlayers);
}
function drawPlayers(snapshot,uid){
 latestPlayers=snapshot.val()||{};
 // Old database records and disconnected devices must not appear as live players.
 const players=activePlayers(latestPlayers);
 const world=document.getElementById("world");
 if(!world)return;
 const localPosition=sessionInfo?.getPosition?.();
 const ownX=Number(localPosition?.x), ownY=Number(localPosition?.y);
 const hasPosition=Number.isFinite(ownX)&&Number.isFinite(ownY);
 // Cap the number of visible sprites when all 100 players crowd around a checkpoint.
 const nearby=Object.entries(players)
  .filter(([id,p])=>id!==uid&&p&&typeof p.name==="string")
  .map(([id,p])=>({id,p,distance:hasPosition?Math.hypot(Number(p.x)-ownX,Number(p.y)-ownY):Infinity}))
  .filter(entry=>Number.isFinite(entry.distance)&&entry.distance<=AVATAR_VISIBILITY_RADIUS)
  .sort((a,b)=>a.distance-b.distance)
  .slice(0,MAX_VISIBLE_REMOTE_AVATARS);
 const visibleIds=new Set(nearby.map(entry=>entry.id));
 for(const {id,p} of nearby){
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
   img.style.cssText="position:absolute;left:0;bottom:0;width:50px;height:62px;object-fit:contain;border:0;outline:none";
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
  if(!visibleIds.has(id)){state.el.remove();others.delete(id);}
 }
 if(!animationId)animationId=requestAnimationFrame(animateRemotePlayers);
 showStatus("👥 "+Object.keys(players).length+"/"+MAX_PLAYERS+" PEMAIN");
}
export async function joinMultiplayer(name, getPosition, selectedAvatar){
 sessionInfo={name,getPosition,selectedAvatar};
 const avatar=["boy1","boy2","girl1","girl2","teacherM","teacherF"].includes(selectedAvatar)?selectedAvatar:"boy1";
 if(joined || document.hidden)return;
 try{
  const user=(await signInAnonymously(auth)).user;
  if(document.hidden)return;
  const playersRef=ref(db,"rooms/kelas/players");
  const current=await new Promise((resolve,reject)=>onValue(playersRef,s=>resolve(s.val()||{}),reject,{onlyOnce:true}));
  if(document.hidden)return;
  if(Object.keys(activePlayers(current)).length>=MAX_PLAYERS&&!activePlayers(current)[user.uid]){showStatus("Bilik penuh ("+MAX_PLAYERS+" pemain)");return;}
  ownRef=ref(db,"rooms/kelas/players/"+user.uid);
  ownUid=user.uid;
  // Firebase removes our record when the network connection actually disconnects.
  await onDisconnect(ownRef).remove();
  if(document.hidden){await leaveMultiplayer();return;}
  // Child listeners receive only the changed player, not the entire 100-player room.
  // Use one animation frame to coalesce bursts of join/move/leave updates.
  let queued=false;
  const requestDraw=()=>{
   if(queued)return;
   queued=true;
   requestAnimationFrame(()=>{queued=false;if(joined)drawPlayers({val:()=>latestPlayers},user.uid);});
  };
  const connectionError=()=>showStatus("Sambungan multiplayer terganggu");
  unsubscribe=[
   onChildAdded(playersRef,s=>{latestPlayers[s.key]=s.val();requestDraw();},connectionError),
   onChildChanged(playersRef,s=>{latestPlayers[s.key]=s.val();requestDraw();},connectionError),
   onChildRemoved(playersRef,s=>{delete latestPlayers[s.key];requestDraw();},connectionError)
  ];
  joined=true;
  if(refreshTimer)clearInterval(refreshTimer);
  refreshTimer=setInterval(()=>drawPlayers({val:()=>latestPlayers},ownUid),3000);
  const update=async()=>{
   if(!joined || document.hidden)return;
   const p=getPosition();if(!p)return;
   const now=Date.now();
   // Update nearby-avatar visibility even without sending data to Firebase.
   if(now-lastMapDraw>=250){lastMapDraw=now;requestDraw();}
   if(now-lastPositionSend<POSITION_UPDATE_MS)return;
   const x=Math.round(Number(p.x)||0),y=Math.round(Number(p.y)||0);
   const direction=p.direction||"down";
   const moved=!lastPosition || Math.hypot(x-lastPosition.x,y-lastPosition.y)>=POSITION_CHANGE_UNITS ||
     direction!==lastPosition.direction;
   if(!moved && now-lastUpdate<HEARTBEAT_MS)return;
   lastPositionSend=now;lastUpdate=now;lastPosition={x,y,direction};
   try{
    await set(ownRef,{name:String(name).slice(0,24),x,y,direction,avatar,updatedAt:serverTimestamp()});
   }catch(e){
    // Support existing deployed RTDB rules until avatar validation is updated.
    try{await set(ownRef,{name:String(name).slice(0,24),x,y,direction,updatedAt:serverTimestamp()});}
    catch(error){showStatus("Multiplayer belum tersedia atau bilik penuh");}
   }
  };
  window.__kspMultiplayerUpdate=update;await update();
 }catch(e){showStatus("Multiplayer belum tersedia");}
}
export async function leaveMultiplayer(){
 joined=false;
 for(const stop of unsubscribe)stop();unsubscribe=[];
 window.__kspMultiplayerUpdate=null;
 if(refreshTimer){clearInterval(refreshTimer);refreshTimer=null;}
 const departing=ownRef;
 ownRef=null;ownUid=null;latestPlayers={};lastPosition=null;lastUpdate=0;lastPositionSend=0;
 for(const state of others.values())state.el.remove();
 others.clear();
 if(animationId)cancelAnimationFrame(animationId);
 animationId=0;animationTime=0;
 if(departing){
  try { await set(departing,null); }
  catch(e) { /* onDisconnect removes it when Firebase detects the lost connection */ }
 }
}

// On an ordinary tab/app switch, remove only this player's avatar.
// Rejoin when this same game tab becomes visible again.
document.addEventListener("visibilitychange",()=>{
 if(document.hidden){
  pendingLeave=leaveMultiplayer();
 }else if(sessionInfo){
  Promise.resolve(pendingLeave).then(()=>{
   if(!document.hidden && sessionInfo)joinMultiplayer(sessionInfo.name,sessionInfo.getPosition,sessionInfo.selectedAvatar);
  });
 }
});
window.addEventListener("pagehide",()=>{ pendingLeave=leaveMultiplayer(); });
window.addEventListener("pageshow",()=>{
 if(!document.hidden && sessionInfo && !joined){
  Promise.resolve(pendingLeave).then(()=>{
   if(!document.hidden && sessionInfo && !joined)joinMultiplayer(sessionInfo.name,sessionInfo.getPosition,sessionInfo.selectedAvatar);
  });
 }
});
