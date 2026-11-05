import React, { useLayoutEffect, useRef } from 'react';

// Mounts the layer's pixel surface inside the SVG composition. The canvas is
// owned by the surface registry, not by React, so live strokes and undo reloads
// never fight React reconciliation.
export default function RasterCanvas({ surfaces, layer }) {
  const host = useRef();
  useLayoutEffect(() => {
    const s = surfaces.ensure(layer);
    const el = host.current;
    if (el && s.canvas.parentNode !== el) { el.replaceChildren(s.canvas); }
  }, [surfaces, layer.id, layer.assetId, layer.w, layer.h]);
  return <foreignObject width={layer.w} height={layer.h} data-raster-id={layer.id} pointerEvents="none">
    <div xmlns="http://www.w3.org/1999/xhtml" ref={host} className="rasterHost" style={{ width: layer.w + 'px', height: layer.h + 'px' }} />
  </foreignObject>;
}
