import {createCanvas,loadImage} from '@napi-rs/canvas';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
// Derive installation icons from the existing vector brand; generated files stay out of Git.
const source=await loadImage(readFileSync(new URL('../public/favicon.svg',import.meta.url)));
mkdirSync(new URL('../public/app-icons/',import.meta.url),{recursive:true});
for(const size of [192,512]){
 const canvas=createCanvas(size,size),context=canvas.getContext('2d');
 context.fillStyle='#173e35';context.fillRect(0,0,size,size);
 context.drawImage(source,size*.15,size*.15,size*.7,size*.7);
 writeFileSync(new URL(`../public/app-icons/${size}.png`,import.meta.url),canvas.toBuffer('image/png'));
}
