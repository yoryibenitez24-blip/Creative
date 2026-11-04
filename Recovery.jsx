import React from'react';
export class EditorBoundary extends React.Component{
 state={error:null};static getDerivedStateFromError(error){return{error}}
 componentDidCatch(error){console.error('Editor recovery:',error)}
 render(){if(!this.state.error)return this.props.children;return <div className="recovery" style={{display:this.props.active?'grid':'none'}}><div><h2>This document needs recovery</h2><p>Your other documents remain available. Download a backup before trying again.</p><pre>{String(this.state.error?.message||'Unexpected rendering error')}</pre><button onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(this.props.document)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='recovery.zertake';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}}>Download project backup</button><button onClick={()=>this.setState({error:null})}>Retry</button>{this.props.documents.filter(d=>d.id!==this.props.id).map(d=><button key={d.id} onClick={()=>this.props.onSelect(d.id)}>Open {d.doc.name}</button>)}</div></div>}
}
