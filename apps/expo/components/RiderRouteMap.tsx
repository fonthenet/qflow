/**
 * RiderRouteMap — Expo Go-compatible embedded map for the rider screen.
 *
 * Rendered as a MapLibre GL JS instance inside a WebView so it works
 * in Expo Go without any native build step.  The HTML is fully self-
 * contained (no external React, no bundler).  The parent pushes rider
 * position updates via injectJavaScript — no remount needed.
 *
 * Tile engine: MapLibre GL JS 4.7.1 + OpenFreeMap "liberty" style.
 * Same CDN + style URL as apps/web/src/components/maps/mapbox-live-map.tsx
 * so the visual language is consistent across platforms.
 */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

// ---------------------------------------------------------------------------
// Moped SVG icon — exact path data from the web MapboxLiveMap component
// (MDI "moped", Apache-2.0).  Encoded once at module load so the string
// doesn't get rebuilt on every render.
// ---------------------------------------------------------------------------
const MOPED_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="56" height="56">
    <defs>
      <filter id="ms" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity="0.35"/>
      </filter>
    </defs>
    <circle cx="16" cy="16" r="14" fill="#ffffff" filter="url(#ms)"/>
    <g transform="translate(4 4)" fill="#1d4ed8">
      <path d="M19 7C18.71 7 18.42 7.05 18.13 7.14L17.66 7L17 5H14L12.61 7H10.13C9.65 7 9.18 7.18 8.83 7.54L7 9.36L7.71 8.66C8.54 7.83 9.66 7.36 10.83 7.36H17.66L18.13 7.14C18.4 7.05 18.7 7 19 7M5 8C5.55 8 6 7.55 6 7S5.55 6 5 6 4 6.45 4 7 4.45 8 5 8M14 12L18 12V13L14 13C14 16.31 11.31 19 8 19V20H7V19C3.69 19 1 16.31 1 13H6V11H10V8H4L4 7C4 5.34 5.34 4 7 4H14L14 12M5 15A2 2 0 0 1 3 13H7A2 2 0 0 1 5 15M19 9C20.66 9 22 10.34 22 12C22 13.66 20.66 15 19 15H17V13H19A1 1 0 0 0 20 12C20 11.45 19.55 11 19 11H15V9L19 9Z"/>
    </g>
  </svg>`,
);
const MOPED_DATA_URI = `data:image/svg+xml;utf8,${MOPED_SVG}`;

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------
function buildMapHtml(opts: {
  destLat: number;
  destLng: number;
  riderLat: number | null;
  riderLng: number | null;
  destColor: string;
  heading: number | null;
}): string {
  const { destLat, destLng, riderLat, riderLng, destColor, heading } = opts;

  // Serialise initial rider position for inline JS (null-safe)
  const initRiderLat = riderLat != null ? riderLat.toString() : 'null';
  const initRiderLng = riderLng != null ? riderLng.toString() : 'null';
  const initHeading = heading != null ? heading.toString() : 'null';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css"/>
<script src="https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body,#map{width:100%;height:100%;overflow:hidden}
</style>
</head>
<body>
<div id="map"></div>
<script>
(function(){
  var DEST_LAT=${destLat}, DEST_LNG=${destLng};
  var DEST_COLOR='${destColor}';
  var MOPED_URI='${MOPED_DATA_URI}';

  var map = new maplibregl.Map({
    container:'map',
    style:'https://tiles.openfreemap.org/styles/liberty',
    center:[DEST_LNG, DEST_LAT],
    zoom:14,
    attributionControl:{compact:true},
    dragPan:true,
    scrollZoom:false
  });

  // Destination pin
  var destEl=document.createElement('div');
  destEl.innerHTML='<svg width="32" height="40" viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.28));display:block">'
    +'<path fill="'+DEST_COLOR+'" d="M16 0C7.16 0 0 6.94 0 15.5c0 11.66 16 24.5 16 24.5s16-12.84 16-24.5C32 6.94 24.84 0 16 0z"/>'
    +'<circle cx="16" cy="15.5" r="5.5" fill="#fff"/>'
    +'</svg>';
  destEl.style.cssText='user-select:none;cursor:default;line-height:0';
  var destMarker=new maplibregl.Marker({element:destEl,anchor:'bottom'})
    .setLngLat([DEST_LNG,DEST_LAT])
    .addTo(map);

  var riderMarker=null;
  var routeReady=false;

  function buildRiderEl(hdg){
    var wrap=document.createElement('div');
    wrap.style.cssText='width:56px;height:56px;position:relative;line-height:0';
    var halo=document.createElement('div');
    halo.style.cssText='position:absolute;inset:6px;border-radius:50%;background:rgba(255,255,255,0.92);box-shadow:0 4px 14px rgba(15,23,42,0.22)';
    var img=document.createElement('img');
    img.src=MOPED_URI;
    img.width=44; img.height=44;
    img.style.cssText='position:absolute;top:6px;left:6px;display:block;user-select:none';
    if(hdg!=null){
      wrap.style.transform='rotate('+hdg+'deg)';
      img.style.transform='rotate(-'+hdg+'deg)'; // counter-rotate so icon stays upright
    }
    wrap.appendChild(halo);
    wrap.appendChild(img);
    return wrap;
  }

  function addRouteLayer(){
    if(map.getSource('rider-path')) return;
    map.addSource('rider-path',{
      type:'geojson',
      data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[]}}
    });
    map.addLayer({
      id:'rider-path-line',type:'line',source:'rider-path',
      layout:{'line-join':'round','line-cap':'round'},
      paint:{'line-color':'#3b82f6','line-width':4,'line-opacity':0.75,'line-dasharray':[2,1.2]}
    });
    routeReady=true;
  }

  function updateRoute(rLng,rLat){
    var src=map.getSource('rider-path');
    if(!src||!src.setData) return;
    src.setData({
      type:'Feature',properties:{},
      geometry:{type:'LineString',coordinates:[[rLng,rLat],[DEST_LNG,DEST_LAT]]}
    });
  }

  function fitBounds(rLng,rLat){
    var bounds=new maplibregl.LngLatBounds([rLng,rLat],[rLng,rLat]).extend([DEST_LNG,DEST_LAT]);
    var latDiff=Math.abs(rLat-DEST_LAT), lngDiff=Math.abs(rLng-DEST_LNG);
    // Skip fit if markers are essentially on top of each other
    if(latDiff<0.0001&&lngDiff<0.0001){
      map.setCenter([DEST_LNG,DEST_LAT]);
      map.setZoom(16);
      return;
    }
    try{ map.fitBounds(bounds,{padding:60,maxZoom:16,duration:800}); }catch(e){}
  }

  function placeRider(lat,lng,hdg){
    if(!riderMarker){
      riderMarker=new maplibregl.Marker({element:buildRiderEl(hdg),anchor:'center'})
        .setLngLat([lng,lat]).addTo(map);
    } else {
      riderMarker.setLngLat([lng,lat]);
      // Heading update: replace element only when heading changes significantly
      if(hdg!=null){
        var el=riderMarker.getElement();
        var wrap=el.firstElementChild||el;
        if(wrap) wrap.style.transform='rotate('+hdg+'deg)';
      }
    }
    if(routeReady) updateRoute(lng,lat);
    fitBounds(lng,lat);
  }

  map.on('load',function(){
    addRouteLayer();
    var iLat=${initRiderLat}, iLng=${initRiderLng}, iHdg=${initHeading};
    if(iLat!=null&&iLng!=null) placeRider(iLat,iLng,iHdg);
  });

  // Public API called via injectJavaScript from the React Native parent
  window.qfRiderUpdate=function(lat,lng,hdg){
    if(!map.loaded()){ map.once('load',function(){ placeRider(lat,lng,hdg||null); }); return; }
    placeRider(lat,lng,hdg||null);
  };
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface RiderRouteMapProps {
  rider: { lat: number; lng: number } | null;
  destination: { lat: number; lng: number; label?: string };
  /**
   * "pickup"  colors the destination marker orange (restaurant / pickup point).
   * "dropoff" colors it green (customer / drop-off point).
   */
  destinationKind: 'pickup' | 'dropoff';
  /** Map height in logical pixels. Defaults to 220. */
  height?: number;
  /** Optional compass heading in degrees (0 = north). Rotates the moped icon. */
  heading?: number | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function RiderRouteMap({
  rider,
  destination,
  destinationKind,
  height = 220,
  heading = null,
}: RiderRouteMapProps) {
  const webViewRef = useRef<WebView>(null);
  const [loaded, setLoaded] = useState(false);

  const destColor = destinationKind === 'pickup' ? '#f97316' : '#16a34a';

  // Build the HTML once — destination never changes mid-delivery.
  // We use a stable string ref so the WebView doesn't remount when
  // only the rider position changes.
  const htmlRef = useRef(
    buildMapHtml({
      destLat: destination.lat,
      destLng: destination.lng,
      riderLat: rider?.lat ?? null,
      riderLng: rider?.lng ?? null,
      destColor,
      heading: heading ?? null,
    }),
  );

  // Push rider position updates into the live MapLibre instance without
  // remounting the WebView.
  useEffect(() => {
    if (!loaded) return;
    if (rider == null) return;
    const lat = rider.lat.toString();
    const lng = rider.lng.toString();
    const hdg = heading != null ? heading.toString() : 'null';
    webViewRef.current?.injectJavaScript(
      `window.qfRiderUpdate&&window.qfRiderUpdate(${lat},${lng},${hdg});true;`,
    );
  }, [rider?.lat, rider?.lng, heading, loaded]);

  return (
    <View style={[styles.container, { height, borderRadius: 12 }]}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: htmlRef.current }}
        javaScriptEnabled
        domStorageEnabled
        style={[styles.webview, { height, borderRadius: 12 }]}
        onLoad={() => setLoaded(true)}
        scrollEnabled={false}
        // Prevent the WebView from capturing the parent scroll gesture
        nestedScrollEnabled={false}
        // Allow map pan gestures inside the WebView
        setBuiltInZoomControls={false}
        // Suppress console noise in production
        onError={() => {}}
        accessibilityLabel="Route map"
        accessibilityHint="Interactive map showing rider position and destination"
      />
      {!loaded && (
        <View style={[styles.loadingOverlay, { borderRadius: 12 }]}>
          <ActivityIndicator size="small" color="#1d4ed8" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: '#e2e8f0',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
