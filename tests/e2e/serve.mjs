// Minimal static server for dist/ used by the browser acceptance tests.
import http from 'node:http';import{readFile}from'node:fs/promises';import{join,extname,normalize}from'node:path';import{fileURLToPath}from'node:url';
const root=join(fileURLToPath(new URL('.',import.meta.url)),'../../dist');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
export function serve(port=0){return new Promise(resolve=>{const s=http.createServer(async(req,res)=>{let p=normalize(decodeURIComponent(new URL(req.url,'http://x').pathname)).replace(/^([/\\])+/,'');if(!p)p='index.html';try{const body=await readFile(join(root,p));res.writeHead(200,{'content-type':types[extname(p)]||'application/octet-stream'});res.end(body)}catch{res.writeHead(404);res.end()}});s.listen(port,'127.0.0.1',()=>resolve(s))})}
if(process.argv[1]===fileURLToPath(import.meta.url)){const s=await serve(+process.argv[2]||4173);console.log('Serving dist on http://127.0.0.1:'+s.address().port)}
