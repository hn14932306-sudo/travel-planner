import { useState, useEffect, useRef } from 'react';
import { APIProvider, Map, useMap, useMapsLibrary, AdvancedMarker, InfoWindow } from '@vis.gl/react-google-maps';
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { HashRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, onSnapshot, setDoc } from 'firebase/firestore';

// ----------------------------------------------------
// ⚙️ 配置
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
interface Spot { 
  id: string; 
  name: string; 
  address: string; 
  lat: number; 
  lng: number; 
  place_id?: string; 
  isRestaurant?: boolean; 
  mealType?: 'lunch' | 'dinner' | null;
}

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
    const ac = new placesLib.Autocomplete(inputRef.current, { 
      fields: ['name', 'geometry', 'formatted_address', 'place_id', 'types', 'photos'] 
    });
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
// 🚗 元件：路線時間計算
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

function Home() {
  useEffect(() => {
    document.title = "我的旅遊規劃器";
    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%233b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>`;
    
    let link = (document.querySelector("link[rel*='icon']") as HTMLLinkElement) || document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = `data:image/svg+xml,${svgString.trim()}`;
    
    if (!document.querySelector("link[rel*='icon']")) {
      document.head.appendChild(link);
    }
  }, []);

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-white p-8 text-center">
      <div className="max-w-md w-full">
        <div className="mb-12 flex justify-center">
          <div className="w-16 h-16 bg-blue-50 rounded-3xl flex items-center justify-center text-blue-500 border border-blue-100">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </div>
        </div>
        <h1 className="text-4xl font-light text-slate-800 tracking-[0.2em] mb-4">JOURNEY</h1>
        <div className="h-[1px] w-8 bg-slate-100 mx-auto mb-10"></div>
        <button 
          onClick={() => window.location.hash = `/edit/${Math.random().toString(36).substring(7)}`} 
          className="px-12 py-3.5 bg-white border border-slate-200 text-slate-600 text-[11px] font-bold tracking-[0.2em] uppercase rounded-full hover:border-slate-800 hover:text-slate-800 transition-all active:scale-95 shadow-sm"
        >
          Begin planning
        </button>
      </div>
    </div>
  );
}

function MyLocationMarker() {
  const map = useMap();
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);

  const handleLocationClick = () => {
    navigator.geolocation.getCurrentPosition((p) => {
      const c = { lat: p.coords.latitude, lng: p.coords.longitude };
      setPos(c);
      map?.panTo(c);
      map?.setZoom(15);
    });
  };

  return (
    <>
      <button 
        onClick={handleLocationClick} 
        className="absolute bottom-32 right-6 z-10 bg-white h-12 w-12 rounded-full shadow-md flex items-center justify-center transition-all active:scale-90 border border-slate-100"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 8C9.79 8 8 9.79 8 12C8 14.21 9.79 16 12 16C14.21 16 16 14.21 16 12C16 9.79 14.21 8 12 8ZM20.94 11C20.48 6.83 17.17 3.52 13 3.06V1H11V3.06C6.83 3.52 3.52 6.83 3.06 11H1V13H3.06C3.52 17.17 6.83 20.48 11 20.94V23H13V20.94C17.17 20.48 20.48 17.17 20.94 13H23V11H20.94ZM12 19C8.13 19 5 15.87 5 12C5 8.13 8.13 5 12 5C15.87 5 19 8.13 19 12C19 15.87 15.87 19 12 19Z" fill="#5F6368"/>
        </svg>
      </button>

      {pos && (
        <AdvancedMarker position={pos}>
          <div className="relative flex items-center justify-center h-6 w-6">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-40"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500 border-2 border-white shadow-sm"></span>
          </div>
        </AdvancedMarker>
      )}
    </>
  );
}

// ----------------------------------------------------
// 🏠 旅行頁面組件
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), 
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 10 } })
  );

  useEffect(() => {
    document.title = tripId ? `行程規劃 - ${currentDay}` : "我的旅遊規劃器";
    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%233b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>`;
    
    let link = (document.querySelector("link[rel*='icon']") as HTMLLinkElement) || document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = `data:image/svg+xml,${svgString.trim()}`;
    if (!document.querySelector("link[rel*='icon']")) document.head.appendChild(link);

    if (!tripId) {
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(doc(db, "trips", tripId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setItinerary(data.itinerary || { "Day 1": { spots: [], stay: { name: "" } } });
        setStartDate(data.startDate || "");
      } else {
        setItinerary({ "Day 1": { spots: [], stay: { name: "" } } });
      }
      setLoading(false);
    }, (error) => {
      console.error("Firebase Error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [tripId, currentDay, navigate]);

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
      pl.getDetails({ placeId: spot.place_id, fields: ['name', 'geometry', 'formatted_address', 'photos', 'types', 'place_id'] }, (p: any, s: any) => {
        if (s === 'OK') { setPendingPlace(p); setInfoWindowPos(pos); }
      });
    } else {
      setPendingPlace({ name: spot.name, formatted_address: spot.address });
      setInfoWindowPos(pos);
    }
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  if (loading || !itinerary) {
    return <div className="h-screen flex items-center justify-center font-black animate-pulse text-slate-400 bg-slate-900">CONNECTING...</div>;
  }

  const days = Object.keys(itinerary).sort((a, b) => {
    const numA = parseInt(a.replace('Day ', ''));
    const numB = parseInt(b.replace('Day ', ''));
    return numA - numB;
  });

  const currentData = itinerary[currentDay] || { spots: [], stay: { name: "" } };
  const dayIndex = days.indexOf(currentDay);
  const isFirstDay = dayIndex === 0;
  const isLastDay = dayIndex === days.length - 1;

  return (
    <div className="flex h-screen w-full bg-slate-50 overflow-hidden font-sans relative">
      <div className={`md:hidden fixed inset-0 bg-slate-900/20 z-[60] backdrop-blur-[2px] transition-opacity ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setIsSidebarOpen(false)} />
      
      <div className={`fixed md:relative z-[70] h-full w-[340px] bg-white shadow-2xl flex flex-col transition-transform duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-4 border-b flex gap-2 overflow-x-auto no-scrollbar">
          {days.map((d, i) => (
  <button 
    key={d} 
    onClick={() => { setCurrentDay(d); setIsSidebarOpen(false); }} 
    className={`px-6 py-2.5 rounded-full text-xs font-black shrink-0 transition-all active:scale-90 ${
      currentDay === d ? 'bg-slate-800 text-white shadow-xl' : 'bg-slate-100 text-slate-400'
    } ${isToday(getDayDate(startDate, i)) ? 'border-2 border-amber-400' : ''}`}
  >
    {d}
    <span className="block text-[9px] opacity-70 font-medium">{getDayDate(startDate, i).slice(5)}</span>
  </button>
))}
          {!isReadOnly && <button onClick={() => { const next = `Day ${days.length + 1}`; const ni = { ...itinerary, [next]: { spots: [], stay: { name: "" } } }; setItinerary(ni); save(ni, startDate); }} className="w-7 h-7 rounded-full bg-slate-50 text-slate-300 flex items-center justify-center text-xs shrink-0">+</button>}
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
              <div className="flex justify-between items-center mb-1">
                <span className="text-[9px] font-black text-blue-400 uppercase tracking-tighter">Accommodation</span>
                {!isFirstDay && !isReadOnly && (
                  <button 
                    onClick={() => {
                      const prevDay = `Day ${dayIndex}`;
                      const prevStay = itinerary[prevDay]?.stay;
                      if (prevStay?.name) {
                        const ni = { ...itinerary, [currentDay]: { ...currentData, stay: { ...prevStay } } };
                        setItinerary(ni); save(ni, startDate);
                      }
                    }}
                    className="text-[9px] font-bold text-blue-500 hover:text-blue-700 transition-colors"
                  >
                    ＋ 延用前日住宿
                  </button>
                )}
              </div>
              <PlaceInput placeholder="設定住宿..." icon="🏨" value={currentData.stay?.name || ""} 
                onChange={(v: string) => {
                  const newStay = v.trim() === "" ? { name: "" } : { ...currentData.stay, name: v };
                  const ni = { ...itinerary, [currentDay]: { ...currentData, stay: newStay } };
                  setItinerary(ni); save(ni, startDate);
                }} 
                onSelect={(p: any) => {
                  const ni = { ...itinerary, [currentDay]: { ...currentData, stay: { name: p.name, lat: p.geometry.location.lat(), lng: p.geometry.location.lng() } } };
                  setItinerary(ni); save(ni, startDate);
                }} 
              />
            </div>
          </div>

          <div className="space-y-0">
            {isFirstDay && !!currentData.airport?.lat && (
              <div onClick={() => focusOnSpot(currentData.airport)} className="bg-slate-800 p-3 rounded-xl text-center cursor-pointer text-white font-black text-[10px]">✈️ 從機場出發</div>
            )}
            {isFirstDay && !!currentData.airport?.lat && !!currentData.stay?.lat && <LegTimeItem leg={legs[0]} mode={travelMode} />}

            {!!currentData.stay?.lat && (
              <div onClick={() => focusOnSpot(currentData.stay)} className={`p-3 rounded-xl border border-dashed text-center cursor-pointer font-bold text-[10px] ${isFirstDay ? 'bg-blue-600 text-white border-none shadow-md' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                {isFirstDay ? '🏨 第一站：住宿 / 寄放行李' : '🏨 從住宿出發'}
              </div>
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
                  const legIndex = isFirstDay && !!currentData.airport?.lat ? idx + 1 : idx;
                  return (
                    <div key={s.id}>
                      <LegTimeItem leg={legs[legIndex]} mode={travelMode} />
                      <SortableCard spot={s} index={idx} isReadOnly={isReadOnly} onFocus={() => focusOnSpot(s)} onRemove={(id: string) => { const ni = {...itinerary, [currentDay]: {...currentData, spots: currentData.spots.filter(x => x.id !== id)}}; setItinerary(ni); save(ni, startDate); }} />
                    </div>
                  );
                })}
              </SortableContext>
            </DndContext>

            {isLastDay && !!currentData.airport?.lat ? (
              <>
                <LegTimeItem leg={legs[legs.length - 1]} mode={travelMode} />
                <div onClick={() => focusOnSpot(currentData.airport)} className="bg-slate-800 p-3 rounded-xl text-center cursor-pointer text-white font-black text-[10px] mt-2">✈️ 前往機場 / 回家</div>
              </>
            ) : !!currentData.stay?.lat && currentData.spots.length > 0 && (
              <>
                <LegTimeItem leg={legs[legs.length - 1]} mode={travelMode} />
                <div onClick={() => focusOnSpot(currentData.stay)} className="bg-slate-50 p-3 rounded-xl border border-dashed border-slate-200 text-center cursor-pointer text-slate-400 font-bold text-[10px]">🏨 返回住宿</div>
              </>
            )}
          </div>
          
          {!isReadOnly && (
  <div className="mt-8 bg-white rounded-xl shadow-sm border border-slate-200 px-4 h-11 flex items-center focus-within:border-blue-400 transition-colors">
    <PlaceInput 
      placeholder="搜尋景點並自動帶入位置代碼..." 
      icon="🔍" 
      onChange={() => {}} 
      // 在 TripPage.tsx 的 PlaceInput 區塊
onSelect={(p: any) => { 
  // 檢查是否有 plus_code，如果沒有則留空
  const plusCode = p.plus_code?.global_code || p.plus_code?.compound_code || "";

  const newSpot = { 
    id: Date.now().toString(), 
    name: p.name, 
    address: p.formatted_address, 
    lat: p.geometry.location.lat(), 
    lng: p.geometry.location.lng(), 
    place_id: p.place_id,
    // 🟢 確保這裡有正確賦值
    mapCode: plusCode 
  };

  const ni = {
    ...itinerary, 
    [currentDay]: {
      ...currentData, 
      spots: [...currentData.spots, newSpot]
    }
  };

  setItinerary(ni); 
  save(ni, startDate);
}}
    />
  </div>
)}
        </div>
      </div>

      <div className="flex-1 relative">
        <button className="md:hidden absolute top-6 left-6 z-[55] bg-slate-900 text-white h-12 w-12 rounded-full shadow-lg flex items-center justify-center text-xl border border-slate-700" onClick={() => setIsSidebarOpen(true)}>☰</button>
        <div className="absolute top-6 right-6 z-[55] flex bg-white rounded-full p-1 border shadow-xl">
            <button onClick={() => setTravelMode('DRIVING')} className={`px-4 py-2 rounded-full text-xs font-bold ${travelMode === 'DRIVING' ? 'bg-slate-800 text-white' : 'text-slate-400'}`}>🚗 開車</button>
            <button onClick={() => setTravelMode('WALKING')} className={`px-4 py-2 rounded-full text-xs font-bold ${travelMode === 'WALKING' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>🚶 步行</button>
        </div>

        <Map mapId="MAIN_MAP" gestureHandling="greedy" defaultCenter={{ lat: 26.212, lng: 127.681 }} defaultZoom={13} disableDefaultUI onClick={(e: any) => {
          if (!e.detail.placeId) return;
          const pl = new (window as any).google.maps.places.PlacesService(map);
          pl.getDetails({ placeId: e.detail.placeId, fields: ['name', 'geometry', 'formatted_address', 'photos', 'types', 'place_id'] }, (p: any, s: any) => {
            if (s === 'OK') { setPendingPlace(p); setInfoWindowPos(e.detail.latLng); }
          });
        }}>
          <DirectionsManager spots={currentData.spots} stay={currentData.stay} airport={currentData.airport} isFirstDay={isFirstDay} isLastDay={isLastDay} travelMode={travelMode} onLegsUpdate={setLegs} />
          <MyLocationMarker />
          {currentData.spots.map((s, idx) => (
            s.lat && s.name && (
              <AdvancedMarker key={s.id} position={{ lat: s.lat, lng: s.lng }} onClick={() => focusOnSpot(s)}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black border-2 border-white shadow-xl ${
                  s.mealType === 'lunch' ? 'bg-orange-500 text-white' : 
                  s.mealType === 'dinner' ? 'bg-orange-900 text-white' : 
                  'bg-slate-800 text-white'
                }`}>
                  {s.mealType ? '🍴' : idx + 1}
                </div>
              </AdvancedMarker>
            )
          ))}

          {currentData.stay?.lat && currentData.stay?.name && (
            <AdvancedMarker 
              position={{ lat: currentData.stay.lat, lng: currentData.stay.lng }} 
              onClick={() => focusOnSpot(currentData.stay)}
            >
              <div className="flex flex-col items-center">
                <div className="bg-blue-600 text-white px-3 py-1.5 rounded-full shadow-xl flex items-center gap-2 border-2 border-white animate-fade-in">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                    <polyline points="9 22 9 12 15 12 15 22"></polyline>
                  </svg>
                  <span className="text-[11px] font-black whitespace-nowrap">{currentData.stay.name}</span>
                </div>
                <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-blue-600 -mt-[1px] shadow-sm"></div>
              </div>
            </AdvancedMarker>
          )}

          {currentData.airport?.lat && currentData.airport?.name && (isFirstDay || isLastDay) && (
            <AdvancedMarker position={{ lat: currentData.airport.lat, lng: currentData.airport.lng }} onClick={() => focusOnSpot(currentData.airport)}>
              <div className="bg-amber-500 text-white px-2 py-1 rounded shadow-xl text-[10px] font-black border border-white">✈️ {currentData.airport.name}</div>
            </AdvancedMarker>
          )}

          {infoWindowPos && (
            <InfoWindow position={infoWindowPos} onCloseClick={() => setInfoWindowPos(null)}>
              <div className="p-0 max-w-[220px] overflow-hidden">
                {pendingPlace?.photos && <img src={pendingPlace.photos[0].getUrl()} className="w-full h-28 object-cover rounded-t" />}
                <div className="p-2">
                  <h4 className="font-bold text-sm mb-1">{pendingPlace.name}</h4>
                  {!isReadOnly ? (
                    <div className="flex flex-col gap-1 mt-2">
                      {(() => {
                        const isRest = pendingPlace.types?.includes('restaurant') || pendingPlace.types?.includes('food') || pendingPlace.types?.includes('cafe');
                        const addSpot = (type: 'lunch' | 'dinner' | null) => {
                          const ni = { ...itinerary, [currentDay]: { ...currentData, spots: [...currentData.spots, { id: Date.now().toString(), name: pendingPlace.name, address: pendingPlace.formatted_address, lat: infoWindowPos.lat, lng: infoWindowPos.lng, place_id: pendingPlace.place_id, isRestaurant: isRest || !!type, mealType: type }] } };
                          setItinerary(ni); save(ni, startDate); setInfoWindowPos(null);
                        };
                        return (
                          <>
                            {isRest ? (
                              <>
                                <button onClick={() => addSpot('lunch')} className="bg-orange-500 text-white text-[10px] py-2 rounded font-bold">☀️ 加入中餐</button>
                                <button onClick={() => addSpot('dinner')} className="bg-orange-900 text-white text-[10px] py-2 rounded font-bold">🌙 加入晚餐</button>
                              </>
                            ) : (
                              <button onClick={() => addSpot(null)} className="bg-slate-800 text-white text-[10px] py-2 rounded font-bold">+ 加入行程</button>
                            )}
                            <button onClick={() => {
                              const ni = { ...itinerary, [currentDay]: { ...currentData, stay: { name: pendingPlace.name, lat: infoWindowPos.lat, lng: infoWindowPos.lng } } };
                              setItinerary(ni); save(ni, startDate); setInfoWindowPos(null);
                            }} className="bg-blue-600 text-white text-[10px] py-2 rounded font-bold">🏨 設為住宿</button>
                          </>
                        );
                      })()}
                    </div>
                  ) : (
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pendingPlace.name)}&query_place_id=${pendingPlace.place_id}`} target="_blank" rel="noreferrer" className="block text-center bg-slate-900 text-white text-[10px] py-2 rounded mt-2 font-bold no-underline">在地圖開啟</a>
                  )}
                </div>
              </div>
            </InfoWindow>
          )}
        </Map>
      </div>

{!isReadOnly && (
  <div className="fixed bottom-10 left-1/2 -translate-x-1/2 md:left-[calc(340px+50%)] md:-translate-x-1/2 z-[100] w-full max-w-[240px] px-4">
    <button 
      onClick={() => { 
        const url = window.location.href.replace('edit', 'view'); 
        navigator.clipboard.writeText(url); 
        alert('連結已複製！'); 
      }} 
      className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-sm shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3 border-t border-slate-700"
    >
      <span className="text-lg">🔗</span> 分享行程
    </button>
  </div>
)}
    </div>
  );
}

function SortableCard({ spot, index, isReadOnly, onRemove, onFocus }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: spot.id, disabled: isReadOnly });
  const style = { transform: CSS.Translate.toString(transform), transition, zIndex: isDragging ? 100 : 1, touchAction: isReadOnly ? 'auto' : 'none' } as React.CSSProperties;

  const getStyle = () => {
    if (spot.mealType === 'lunch') return 'border-orange-200 bg-orange-50/30';
    if (spot.mealType === 'dinner') return 'border-orange-300 bg-orange-100/30';
    return 'border-slate-100 bg-white';
  };

  return (
    <div ref={setNodeRef} style={style} className={`rounded-xl border-2 shadow-sm mb-2 overflow-hidden ${getStyle()} ${isDragging ? 'opacity-50 scale-105 shadow-xl' : ''}`}>
      <div className="flex items-stretch">
        {!isReadOnly && (
          <div {...listeners} {...attributes} className="w-10 flex items-center justify-center cursor-grab border-r text-slate-300 hover:text-slate-500 transition-colors bg-slate-50/50">⋮⋮</div>
        )}
        <div className="flex-1 p-4 cursor-pointer" onClick={onFocus}>
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <h3 className="font-bold text-slate-800 text-sm leading-tight flex items-center gap-1">
                {spot.mealType === 'lunch' && <span className="text-orange-500 text-[10px] font-black">☀️ 中餐</span>}
                {spot.mealType === 'dinner' && <span className="text-orange-900 text-[10px] font-black">🌙 晚餐</span>}
                {!spot.mealType && <span className="text-blue-500 mr-1">{index + 1}.</span>}
                <span>{spot.name}</span>
              </h3>
              <p className="text-[10px] text-slate-400 mt-1 line-clamp-1">{spot.address}</p>
            </div>
            {!isReadOnly && (
              <button onClick={(e) => { e.stopPropagation(); onRemove(spot.id); }} className="ml-2 text-slate-300 hover:text-red-500 p-1 transition-colors">✕</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LegTimeItem({ leg, mode }: any) {
  if (!leg) return <div className="h-4" />;
  return (
    <div className="flex justify-center -my-1 relative h-10 z-0">
      <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-slate-100 -translate-x-1/2" />
      <div className="relative bg-white border border-slate-50 text-slate-400 text-[9px] font-bold px-2 py-0.5 rounded-full my-auto flex items-center gap-1 shadow-sm">
        <span>{mode === 'WALKING' ? '🚶' : '🚗'}</span><span>{leg.duration?.text}</span>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/edit/:tripId" element={<TripPage isReadOnly={false} />} />
          <Route path="/view/:tripId" element={<TripPage isReadOnly={true} />} />
        </Routes>
      </HashRouter>
    </APIProvider>
  );
}