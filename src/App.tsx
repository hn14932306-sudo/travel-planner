import { useState, useEffect, useRef } from 'react';
import { APIProvider, Map, useMap, useMapsLibrary, AdvancedMarker, InfoWindow } from '@vis.gl/react-google-maps';
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { HashRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, onSnapshot, setDoc } from 'firebase/firestore';

// ----------------------------------------------------
// ⚙️ 初始化與配置
// ----------------------------------------------------
declare const google: any;

const firebaseConfig = {
  apiKey: "AIzaSyDK1EdF0GOJpjFup-LpdVqX6iRKalyWHcw",
  authDomain: "travel-planner-bbecd.firebaseapp.com",
  projectId: "travel-planner-bbecd",
  storageBucket: "travel-planner-bbecd.firebasestorage.app",
  messagingSenderId: "462311678492",
  appId: "1:462311678492:web:2c056baf0b47fbba21f5d9",
  measurementId: "G-WH28P4Z1LL"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const GOOGLE_MAPS_API_KEY = 'AIzaSyCQpryac7IVXcPuqCaR08lO9W9W4oaAoZw';

// --- 資料結構 ---
interface Spot { id: string; name: string; address: string; lat: number; lng: number; place_id?: string; }
interface DayData { 
  spots: Spot[]; 
  stay: { name: string; lat?: number; lng?: number }; 
  airport?: { name: string; lat?: number; lng?: number };
}

const GRAY_STYLE = { filter: 'grayscale(1) brightness(1.1) opacity(0.5)', userSelect: 'none' as const };
const getDayDate = (startStr: string, dayIndex: number) => {
  if (!startStr) return "";
  const date = new Date(startStr);
  date.setDate(date.getDate() + dayIndex);
  return date.toISOString().split('T')[0];
};
const isToday = (dateStr: string) => dateStr === new Date().toISOString().split('T')[0];

// ----------------------------------------------------
// 🧩 元件：自動完成輸入框
// ----------------------------------------------------
function PlaceInput({ value, onChange, placeholder, icon, onSelect, isPlainInput = false }: any) {
  const map = useMap();
  const placesLib = useMapsLibrary('places');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!placesLib || !inputRef.current || isPlainInput) return;
    const ac = new placesLib.Autocomplete(inputRef.current, { fields: ['name', 'geometry', 'formatted_address', 'place_id', 'types', 'photos', 'rating'] });
    ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      if (place.name) {
        onChange(place.name);
        if (onSelect) onSelect(place);
        if (map && place.geometry?.location) map.panTo(place.geometry.location);
      }
    });
  }, [placesLib, map, isPlainInput, onChange, onSelect]);

  return (
    <div className="flex items-center gap-3 w-full">
      <span style={GRAY_STYLE} className="shrink-0 text-sm">{icon}</span>
      <input ref={inputRef} type="text" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent outline-none text-xs font-bold w-full placeholder-slate-300" />
    </div>
  );
}

// ----------------------------------------------------
// 🚗 元件：時間計算邏輯 (Day 1: 機場 -> 住宿 -> 景點)
// ----------------------------------------------------
function DirectionsManager({ spots, stay, airport, isFirstDay, isLastDay, travelMode, onLegsUpdate }: any) {
  useEffect(() => {
    const points: any[] = [];
    
    if (isFirstDay) {
      if (airport?.lat) points.push({ lat: airport.lat, lng: airport.lng });
      if (stay?.lat) points.push({ lat: stay.lat, lng: stay.lng });
      spots.forEach((s: any) => points.push({ lat: s.lat, lng: s.lng }));
    } else if (isLastDay) {
      if (stay?.lat) points.push({ lat: stay.lat, lng: stay.lng });
      spots.forEach((s: any) => points.push({ lat: s.lat, lng: s.lng }));
      if (airport?.lat) points.push({ lat: airport.lat, lng: airport.lng });
    } else {
      if (stay?.lat) points.push({ lat: stay.lat, lng: stay.lng });
      spots.forEach((s: any) => points.push({ lat: s.lat, lng: s.lng }));
      if (stay?.lat && spots.length > 0) points.push({ lat: stay.lat, lng: stay.lng });
    }

    if (points.length < 2) {
      onLegsUpdate([]);
      return;
    }

    const service = new google.maps.DirectionsService();
    service.route({
      origin: points[0],
      destination: points[points.length - 1],
      waypoints: points.slice(1, -1).map((p: any) => ({ location: p, stopover: true })),
      travelMode: google.maps.TravelMode[travelMode] || google.maps.TravelMode.DRIVING
    }, (res: any, status: any) => {
      if (status === 'OK' && res) onLegsUpdate(res.routes[0].legs);
    });
  }, [spots, stay, airport, isFirstDay, isLastDay, travelMode, onLegsUpdate]);

  return null;
}

// ----------------------------------------------------
// 🏠 旅行頁面組件 (雲端同步)
// ----------------------------------------------------
function TripPage({ isReadOnly }: { isReadOnly: boolean }) {
  const { tripId } = useParams(); 
  const navigate = useNavigate();
  const map = useMap();
  
  const [itinerary, setItinerary] = useState<Record<string, DayData> | null>(null);
  const [startDate, setStartDate] = useState("");
  const [currentDay, setCurrentDay] = useState("Day 1");
  const [travelMode, setTravelMode] = useState('DRIVING');
  const [legs, setLegs] = useState<any[]>([]);
  const [pendingPlace, setPendingPlace] = useState<any>(null);
  const [infoWindowPos, setInfoWindowPos] = useState<any>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 10 } }));

  useEffect(() => {
    if (!tripId) {
      const newId = Math.random().toString(36).substring(7);
      const initial = { "Day 1": { spots: [], stay: { name: "" } } };
      setDoc(doc(db, "trips", newId), { itinerary: initial, startDate: "" });
      navigate(`/edit/${newId}`);
      return;
    }

    const unsubscribe = onSnapshot(doc(db, "trips", tripId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setItinerary(data.itinerary);
        setStartDate(data.startDate || "");
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [tripId, navigate]);

  const save = (newItinerary: any, newDate: string) => {
    if (!tripId) return;
    setDoc(doc(db, "trips", tripId), { itinerary: newItinerary, startDate: newDate }, { merge: true });
  };

  const focusOnSpot = (spot: any) => {
    if (!map || !spot.lat) return;
    const pos = { lat: spot.lat, lng: spot.lng };
    map.panTo(pos);
    map.setZoom(16);
    if (spot.place_id) {
      const pl = new (window as any).google.maps.places.PlacesService(map);
      pl.getDetails({ placeId: spot.place_id, fields: ['name', 'geometry', 'formatted_address', 'photos', 'rating', 'place_id', 'types'] }, (p: any, s: any) => {
        if (s === 'OK') { setPendingPlace(p); setInfoWindowPos(pos); }
      });
    } else {
      setPendingPlace({ name: spot.name, formatted_address: spot.address });
      setInfoWindowPos(pos);
    }
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  if (loading || !itinerary) return <div className="h-screen flex items-center justify-center font-black animate-pulse text-slate-400">CONNECTING...</div>;

  const days = Object.keys(itinerary);
  const dayIndex = days.indexOf(currentDay);
  const currentData = itinerary[currentDay];
  const isFirstDay = dayIndex === 0;
  const isLastDay = dayIndex === days.length - 1;

  return (
    <div className="flex h-screen w-full bg-slate-50 overflow-hidden font-sans relative">
      <div className={`md:hidden fixed inset-0 bg-slate-900/20 z-[60] backdrop-blur-[2px] transition-opacity ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setIsSidebarOpen(false)} />
      
      <div className={`fixed md:relative z-[70] h-full w-[340px] bg-white shadow-2xl flex flex-col transition-transform duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-4 border-b flex gap-2 overflow-x-auto no-scrollbar">
          {days.map((d, i) => (
            <button key={d} onClick={() => { setCurrentDay(d); setIsSidebarOpen(false); }} className={`px-4 py-1.5 rounded-full text-[10px] font-black shrink-0 transition-all ${currentDay === d ? 'bg-slate-800 text-white shadow-lg' : 'bg-slate-50 text-slate-300'} ${isToday(getDayDate(startDate, i)) ? 'border-2 border-amber-400' : ''}`}>
              {d} <span className="block text-[8px] opacity-60">{getDayDate(startDate, i).slice(5)}</span>
            </button>
          ))}
          {!isReadOnly && <button onClick={() => { const next = `Day ${days.length + 1}`; const ni = { ...itinerary, [next]: { spots: [], stay: { name: "" } } }; setItinerary(ni); save(ni, startDate); }} className="w-7 h-7 rounded-full bg-slate-50 text-slate-300 flex items-center justify-center text-xs shrink-0">+</button>}
        </div>

        <div className="px-6 py-3 border-b flex items-center justify-between bg-slate-50/50">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">移動方式</span>
          <div className="flex bg-white rounded-lg p-1 border">
            <button onClick={() => setTravelMode('DRIVING')} className={`px-3 py-1 rounded-md text-[10px] font-bold ${travelMode === 'DRIVING' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400'}`}>🚗</button>
            <button onClick={() => setTravelMode('WALKING')} className={`px-3 py-1 rounded-md text-[10px] font-bold ${travelMode === 'WALKING' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400'}`}>🚶</button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <h1 className="text-3xl font-black text-slate-800 tracking-tighter mb-6">{currentDay}</h1>

          <div className="space-y-3 mb-6">
            {isFirstDay && !isReadOnly && (
              <div className="bg-amber-50 p-3 rounded-xl border border-amber-100 flex items-center gap-3">
                <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); save(itinerary, e.target.value); }} className="bg-transparent text-xs font-bold w-full outline-none" />
              </div>
            )}
            {(isFirstDay || isLastDay) && (
              <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
                <PlaceInput placeholder="設定機場..." icon="✈️" value={currentData.airport?.name || ""} 
                  onChange={(v:string) => { const ni = {...itinerary, [currentDay]: {...currentData, airport: {...currentData.airport, name: v}}}; setItinerary(ni); save(ni, startDate); }} 
                  onSelect={(p:any) => { const ni = {...itinerary, [currentDay]: {...currentData, airport: {name: p.name, lat: p.geometry.location.lat(), lng: p.geometry.location.lng()}}}; setItinerary(ni); save(ni, startDate); }} 
                />
              </div>
            )}
            <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-100">
              <PlaceInput placeholder="設定住宿..." icon="🏨" value={currentData.stay?.name || ""} 
                onChange={(v:string) => { const ni = {...itinerary, [currentDay]: {...currentData, stay: {...currentData.stay, name: v}}}; setItinerary(ni); save(ni, startDate); }} 
                onSelect={(p:any) => { const ni = {...itinerary, [currentDay]: {...currentData, stay: {name: p.name, lat: p.geometry.location.lat(), lng: p.geometry.location.lng()}}}; setItinerary(ni); save(ni, startDate); }} 
              />
            </div>
          </div>

          <div className="space-y-0">
            {/* Day 1: 機場出發 */}
            {isFirstDay && !!currentData.airport?.lat && (
              <div onClick={() => focusOnSpot(currentData.airport)} className="bg-slate-800 p-3 rounded-xl text-center cursor-pointer text-white font-black text-[10px]">✈️ 從機場出發</div>
            )}

            {/* Day 1 時間: 機場 -> 住宿 */}
            {isFirstDay && !!currentData.airport?.lat && !!currentData.stay?.lat && <LegTimeItem leg={legs[0]} mode={travelMode} />}

            {/* 住宿點標籤 */}
            {!!currentData.stay?.lat && (
              <div onClick={() => focusOnSpot(currentData.stay)} className={`p-3 rounded-xl border border-dashed text-center cursor-pointer font-bold text-[10px] ${isFirstDay ? 'bg-blue-600 text-white border-none shadow-md' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                {isFirstDay ? '🏨 第一站：住宿 / 寄放行李' : '🏨 從住宿出發'}
              </div>
            )}

            {/* 住宿出發後的時間 */}
            {(!!currentData.stay?.lat || (isFirstDay && !!currentData.airport?.lat)) && currentData.spots.length > 0 && (
                <LegTimeItem leg={isFirstDay && !!currentData.airport?.lat ? legs[1] : legs[0]} mode={travelMode} />
            )}

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => {
              if (isReadOnly) return;
              const { active, over } = e;
              if (over && active.id !== over.id) {
                const ni = { ...itinerary, [currentDay]: { ...currentData, spots: arrayMove(currentData.spots, currentData.spots.findIndex(s => s.id === active.id), currentData.spots.findIndex(s => s.id === over.id)) } };
                setItinerary(ni); save(ni, startDate);
              }
            }}>
              <SortableContext items={currentData.spots.map(s => s.id)} strategy={verticalListSortingStrategy}>
                {currentData.spots.map((s, idx) => {
                  const legIndex = isFirstDay && !!currentData.airport?.lat ? idx + 2 : idx + 1;
                  return (
                    <div key={s.id}>
                      <SortableCard spot={s} index={idx} isReadOnly={isReadOnly} onFocus={() => focusOnSpot(s)} onRemove={(id: string) => { const ni = {...itinerary, [currentDay]: {...currentData, spots: currentData.spots.filter(x => x.id !== id)}}; setItinerary(ni); save(ni, startDate); }} />
                      {(idx < currentData.spots.length - 1 || (isLastDay && !!currentData.airport?.lat)) && <LegTimeItem leg={legs[legIndex]} mode={travelMode} />}
                    </div>
                  );
                })}
              </SortableContext>
            </DndContext>

            {/* 最後一天往機場的時間與標籤 */}
            {isLastDay && !!currentData.airport?.lat ? (
              <div onClick={() => focusOnSpot(currentData.airport)} className="bg-slate-800 p-3 rounded-xl text-center cursor-pointer text-white font-black text-[10px] mt-2">✈️ 前往機場 / 回家</div>
            ) : !!currentData.stay?.lat && currentData.spots.length > 0 && (
              <><LegTimeItem leg={legs[legs.length-1]} mode={travelMode} /><div onClick={() => focusOnSpot(currentData.stay)} className="bg-slate-50 p-3 rounded-xl border border-dashed border-slate-200 text-center cursor-pointer text-slate-400 font-bold text-[10px]">🏨 返回住宿</div></>
            )}
          </div>
          
          {!isReadOnly && (
            <div className="mt-8 bg-white rounded-xl shadow-sm border border-slate-200 px-4 h-11 flex items-center">
              <PlaceInput placeholder="搜尋景點..." icon="🔍" onChange={() => {}} onSelect={(p: any) => { 
                const ni = {...itinerary, [currentDay]: {...currentData, spots: [...currentData.spots, { id: Date.now().toString(), name: p.name, address: p.formatted_address, lat: p.geometry.location.lat(), lng: p.geometry.location.lng(), place_id: p.place_id }]}};
                setItinerary(ni); save(ni, startDate);
              }} />
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 relative">
        <button style={GRAY_STYLE} className="md:hidden absolute top-6 left-6 z-[55] bg-white h-12 w-12 rounded-full shadow-lg flex items-center justify-center text-xl border border-slate-50" onClick={() => setIsSidebarOpen(true)}>☰</button>
        <Map mapId="MAIN_MAP" defaultCenter={{ lat: 25.03, lng: 121.56 }} defaultZoom={13} disableDefaultUI onClick={(e: any) => {
          if (!e.detail.placeId) return;
          const pl = new (window as any).google.maps.places.PlacesService(map);
          pl.getDetails({ placeId: e.detail.placeId, fields: ['name', 'geometry', 'formatted_address', 'photos', 'rating', 'place_id', 'types'] }, (p: any, s: any) => {
            if (s === 'OK') { setPendingPlace(p); setInfoWindowPos(e.detail.latLng); }
          });
        }}>
          <DirectionsManager spots={currentData.spots} stay={currentData.stay} airport={currentData.airport} isFirstDay={isFirstDay} isLastDay={isLastDay} travelMode={travelMode} onLegsUpdate={setLegs} />
          {currentData.spots.map((s, idx) => (
            <AdvancedMarker key={s.id} position={{ lat: s.lat, lng: s.lng }} onClick={() => focusOnSpot(s)}>
              <div className="bg-slate-800 text-white w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black border-2 border-white shadow-lg">{idx + 1}</div>
            </AdvancedMarker>
          ))}
          {currentData.stay?.lat && (
            <AdvancedMarker position={{ lat: currentData.stay.lat, lng: currentData.stay.lng }} onClick={() => focusOnSpot(currentData.stay)}>
              <div className="bg-blue-600 text-white px-2 py-1 rounded shadow-xl text-[10px] font-black border border-white">🏨 {currentData.stay.name}</div>
            </AdvancedMarker>
          )}
          {currentData.airport?.lat && (isFirstDay || isLastDay) && (
            <AdvancedMarker position={{ lat: currentData.airport.lat, lng: currentData.airport.lng }} onClick={() => focusOnSpot(currentData.airport)}>
              <div className="bg-amber-500 text-white px-2 py-1 rounded shadow-xl text-[10px] font-black border border-white">✈️ {currentData.airport.name}</div>
            </AdvancedMarker>
          )}
          {infoWindowPos && (
            <InfoWindow position={infoWindowPos} onCloseClick={() => setInfoWindowPos(null)}>
              <div className="p-0 max-w-[220px] overflow-hidden font-sans">
                {pendingPlace?.photos && <img src={pendingPlace.photos[0].getUrl()} className="w-full h-28 object-cover rounded-t" />}
                <div className="p-2">
                  <h4 className="font-bold text-sm mb-1">{pendingPlace.name}</h4>
                  {!isReadOnly ? (
                    <div className="flex flex-col gap-1 mt-2">
                      <button onClick={() => {
                        const ni = {...itinerary, [currentDay]: {...currentData, spots: [...currentData.spots, { id: Date.now().toString(), name: pendingPlace.name, address: pendingPlace.formatted_address, lat: infoWindowPos.lat, lng: infoWindowPos.lng, place_id: pendingPlace.place_id }]}};
                        setItinerary(ni); save(ni, startDate); setInfoWindowPos(null);
                      }} className="bg-slate-800 text-white text-[10px] py-2 rounded font-bold">+ 加入行程</button>
                    </div>
                  ) : (
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pendingPlace.name)}&query_place_id=${pendingPlace.place_id}`} target="_blank" className="block text-center bg-slate-900 text-white text-[10px] py-2 rounded mt-2 no-underline font-bold">📍 在地圖開啟</a>
                  )}
                </div>
              </div>
            </InfoWindow>
          )}
          <MyLocationMarker />
        </Map>
      </div>

      {!isReadOnly && (
        <div className="fixed bottom-6 right-6 md:left-[360px] z-[100]">
          <button onClick={() => { const url = window.location.href.replace('edit', 'view'); navigator.clipboard.writeText(url); alert('分享連結已複製！'); }} className="bg-slate-900 text-white px-6 py-3 rounded-full font-black shadow-2xl hover:scale-105 active:scale-95 transition-all">🔗 分享行程</button>
        </div>
      )}
    </div>
  );
}

function SortableCard({ spot, index, isReadOnly, onRemove, onFocus }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: spot.id, disabled: isReadOnly });
  const style = { transform: CSS.Translate.toString(transform), transition, zIndex: isDragging ? 100 : 1, touchAction: isReadOnly ? 'auto' : 'none' } as React.CSSProperties;
  return (
    <div ref={setNodeRef} style={style} className={`bg-white rounded-xl border shadow-sm transition-all overflow-hidden mb-2 ${isDragging ? 'opacity-80 scale-105 z-50 shadow-2xl border-blue-500' : 'border-slate-200 hover:border-blue-300'}`}>
      <div className="flex items-stretch">
        {!isReadOnly && <div {...listeners} {...attributes} className="w-10 bg-slate-50 flex items-center justify-center cursor-grab text-slate-300 hover:text-blue-400 border-r border-slate-100">⋮⋮</div>}
        <div className="flex-1 p-4 cursor-pointer" onClick={onFocus}>
          <div className="flex justify-between items-start">
            <div className="flex-1"><h3 className="font-bold text-slate-800 text-sm leading-tight"><span className="text-blue-500 mr-1">{index + 1}.</span> {spot.name}</h3><p className="text-[10px] text-slate-400 mt-1 line-clamp-1">{spot.address}</p></div>
            {!isReadOnly && <button onClick={(e) => { e.stopPropagation(); onRemove(spot.id); }} className="text-slate-200 hover:text-red-400 font-bold p-1 text-xs shrink-0">✕</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function LegTimeItem({ leg, mode }: any) {
  if (!leg) return <div className="h-4" />;
  return (
    <div className="flex justify-center -my-1 relative h-10">
      <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-slate-100 -translate-x-1/2"></div>
      <div className="relative bg-white border border-slate-50 text-slate-400 text-[9px] font-bold px-2 py-0.5 rounded-full my-auto flex items-center gap-1 shadow-sm">
        <span>{mode === 'WALKING' ? '🚶' : '🚗'}</span><span>{leg.duration?.text}</span>
      </div>
    </div>
  );
}

function MyLocationMarker() {
  const map = useMap();
  const [pos, setPos] = useState<any>(null);
  return (
    <>
      <button onClick={() => navigator.geolocation.getCurrentPosition(p => { const c = { lat: p.coords.latitude, lng: p.coords.longitude }; setPos(c); map?.panTo(c); })} className="absolute bottom-10 right-6 z-10 bg-white h-12 w-12 rounded-full shadow-lg flex items-center justify-center border border-slate-100"><span style={GRAY_STYLE}>🎯</span></button>
      {pos && <AdvancedMarker position={pos}><div className="bg-slate-800 h-4 w-4 rounded-full border-2 border-white shadow-lg animate-pulse" /></AdvancedMarker>}
    </>
  );
}

export default function App() {
  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<TripPage isReadOnly={false} />} />
          <Route path="/edit/:tripId" element={<TripPage isReadOnly={false} />} />
          <Route path="/view/:tripId" element={<TripPage isReadOnly={true} />} />
        </Routes>
      </HashRouter>
    </APIProvider>
  );
}