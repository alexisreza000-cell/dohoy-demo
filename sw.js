// Only push events are handled: application pages always use the network.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let payload={};try{payload=event.data?.json()||{}}catch{payload={body:event.data?.text()||''}}
 const taskId=/^[0-9a-f-]{36}$/i.test(payload.taskId||'')?payload.taskId:null;
 event.waitUntil(self.registration.showNotification(payload.title||'DOHOY',{body:payload.body||'Tienes una nueva actualización.',icon:new URL('icon-192.png',self.registration.scope).href,badge:new URL('icon-192.png',self.registration.scope).href,tag:'dohoy-'+(payload.notificationId||taskId||Date.now()),data:{taskId,activity:!taskId},requireInteraction:false}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const taskId=event.notification.data?.taskId;
 const url=new URL('./',self.registration.scope);if(taskId)url.searchParams.set('task',taskId);else url.searchParams.set('activity','1');
 event.waitUntil((async()=>{const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});const tab=tabs.find(c=>c.url.startsWith(self.registration.scope));if(tab){if(taskId)tab.postMessage({type:'DOHOY_OPEN_TASK',taskId});else tab.postMessage({type:'DOHOY_OPEN_ACTIVITY'});await tab.focus()}else await self.clients.openWindow(url.href)})());
});
