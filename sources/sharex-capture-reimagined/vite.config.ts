import {defineConfig} from 'vite';
import tailwindcss from '@tailwindcss/postcss';
import {fileURLToPath} from 'node:url';
export default defineConfig({base:'./',esbuild:{jsx:'automatic'},resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},css:{postcss:{plugins:[tailwindcss()]}},build:{outDir:'../../public/sharex-capture-reimagined',emptyOutDir:true}});
