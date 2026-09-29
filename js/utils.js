export const storage={get(key,fallback=[]){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}},set(key,value){localStorage.setItem(key,JSON.stringify(value))}};
export const keys={favorites:'music_favorites',recent:'music_recently_played',playlists:'music_playlists',searches:'music_recent_searches',queue:'music_queue',settings:'music_settings'};
export function formatTime(value){if(!Number.isFinite(value)||value<0)return '0:00';return `${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`}
export function coverMarkup(song, className='cover-art'){const wrap=document.createElement('span');wrap.className=className;if(song?.imageUrl){const img=document.createElement('img');img.src=song.imageUrl;img.alt='';img.loading='lazy';wrap.append(img)}else{wrap.textContent='MY'}return wrap}
export function makeIcon(name){const icon=document.createElement('i');icon.dataset.lucide=name;return icon}
export function toast(message){const region=document.querySelector('#toastRegion');const item=document.createElement('div');item.className='toast';item.textContent=message;region.append(item);setTimeout(()=>item.remove(),2600)}
