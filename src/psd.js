import {readPsd} from 'ag-psd';
const blendMap={'normal':'normal','multiply':'multiply','screen':'screen','overlay':'overlay','darken':'darken','lighten':'lighten','difference':'difference','soft light':'soft-light','hard light':'hard-light','color dodge':'color-dodge','color burn':'color-burn','exclusion':'exclusion','hue':'hue','saturation':'saturation','color':'color','luminosity':'luminosity'};
export function convertPsd(psd,name,{uid,rasterize}){
 if(!psd.width||!psd.height||psd.width>8000||psd.height>8000)throw Error('PSD dimensions must be between 1 and 8000 pixels.');
 const layers=[],groups=[],warnings=[];let count=0;
 const walk=(children,parent=null,inherited={visible:true,opacity:1,locked:false})=>{for(const l of [...children].reverse()){
 const id=uid(),label=l.name||'Unnamed layer',visible=inherited.visible&&!l.hidden,opacity=inherited.opacity*(l.opacity??1),locked=inherited.locked||!!l.protected?.position;
 const report=m=>warnings.push(`${label}: ${m}`);
 if(l.children){groups.push({id,name:label,parent,visible,opacity,blend:l.blendMode});if(l.opacity!==undefined&&l.opacity!==1)report('group opacity is applied per child and may look different where layers overlap.');if(l.mask||l.vectorMask||l.effects||l.blendMode&& !['normal','pass through'].includes(l.blendMode))report('group masks, effects or blending are not reproduced.');walk(l.children,id,{visible,opacity,locked});continue}
 count++;
 if(l.mask&&!l.mask.disabled)report('raster mask is not applied.');if(l.vectorMask)report('vector mask is not applied.');if(l.clipping)report('clipping mask is not applied.');if(l.effects)report('Photoshop layer effects are not reproduced.');if(l.adjustment)report('adjustment settings are not applied.');if(l.placedLayer)report('smart object is imported as its rendered layer.');if(l.vectorFill||l.vectorStroke)report('vector content uses its rendered layer.');
 const blend=blendMap[l.blendMode||'normal']||'normal';if(!blendMap[l.blendMode||'normal'])report(`unsupported blend mode ${l.blendMode}, using Normal.`);
 const src=rasterize(l);const w=l.canvas?.width||l.imageData?.width||Math.max(1,(l.right||0)-(l.left||0)),h=l.canvas?.height||l.imageData?.height||Math.max(1,(l.bottom||0)-(l.top||0));
 if(!src){report('no rendered pixels available. This layer is omitted.');continue}
 const item={id,type:'image',name:label,x:l.left||0,y:l.top||0,w,h,rotation:0,opacity,visible,locked,fill:'#ffffff',src,blend,group:parent,psdPath:parent,psdSource:true};
 if(l.text){item.psdText=l.text;report('text keeps its rendered appearance. Convert to editable text in the inspector if needed.');}
 layers.push(item);
 }};
 walk(psd.children||[]);
 if(!layers.length){if(count)throw Error('This PSD has no supported rendered layers. Nothing was imported.');const src=rasterize(psd);if(!src)throw Error('This PSD has no image data.');layers.push({id:uid(),type:'image',name:'Background',x:0,y:0,w:psd.width,h:psd.height,rotation:0,opacity:1,visible:true,locked:false,fill:'#fff',src});warnings.push('This source PSD contains no separate layers. Only its existing composite is available.');}
 return{name:name.replace(/\.psd$/i,''),w:psd.width,h:psd.height,bg:'transparent',layers,psdGroups:groups,importWarnings:warnings};
}
export async function importPsd(file,uid){
 if(file.size>100*1024*1024)throw Error('Choose a PSD smaller than 100 MB.');
 const data=await file.arrayBuffer();const view=new DataView(data);if(data.byteLength<26||view.getUint32(0)!==0x38425053)throw Error('This file is not a valid PSD.');if(view.getUint16(4)!==1)throw Error('PSB files are not supported. Choose a PSD.');if(view.getUint32(14)>8000||view.getUint32(18)>8000)throw Error('PSD dimensions exceed 8000 pixels.');
 const psd=readPsd(data,{skipThumbnail:true,throwForMissingFeatures:false});
 return convertPsd(psd,file.name,{uid,rasterize:l=>l.canvas&&l.canvas.width&&l.canvas.height?l.canvas.toDataURL('image/png'):null});
}
