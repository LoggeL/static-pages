import { mkdir,copyFile } from 'node:fs/promises';
const source=new URL('../',import.meta.url),target=new URL('../../../public/rectify-trennkolonne/',import.meta.url);
const files=['index.html','wissen.html','styles.css','app.js','knowledge.js','charts.js','model.js','thermo.js','session.js','worker.js','cases.js','icon.svg','data/properties.js','data/validation.json','DATA.md','README.md','THIRD_PARTY_NOTICES.md'];
for(const file of files){const to=new URL(file,target);await mkdir(new URL('.',to),{recursive:true});await copyFile(new URL(file,source),to);}
console.log(`Published ${files.length} local assets to public/rectify-trennkolonne.`);
