/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  isSameMonth, 
  isSameDay, 
  addDays, 
  eachDayOfInterval,
  parseISO,
  isToday,
  toDate
} from 'date-fns';
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Trash2, 
  Bell, 
  BellOff, 
  Calendar as CalendarIcon, 
  Clock, 
  LogOut, 
  LogIn,
  AlertCircle,
  Sparkles,
  Send,
  Loader2,
  Cloud,
  Sun,
  CloudRain,
  CloudSnow,
  CloudLightning,
  Wind
} from 'lucide-react';
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { 
  signInWithPopup, 
  onAuthStateChanged, 
  signOut, 
  GoogleAuthProvider,
  User
} from 'firebase/auth';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  updateDoc, 
  serverTimestamp,
  orderBy
} from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---

interface Alarm {
  id: string;
  time: string; // HH:mm
  label: string;
  enabled: boolean;
  days: number[]; // 0-6
}

interface CalendarEvent {
  id: string;
  summary: string;
  start: any; // Firestore Timestamp
  end: any;   // Firestore Timestamp
  description?: string;
}

// --- Weather Widget Component ---

function WeatherWidget() {
  const [weather, setWeather] = useState<{ temp: number; code: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWeather = async () => {
      try {
        const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=56.9496&longitude=24.1052&current=temperature_2m,weather_code&timezone=auto');
        const data = await response.json();
        setWeather({
          temp: Math.round(data.current.temperature_2m),
          code: data.current.weather_code
        });
      } catch (error) {
        console.error("Weather fetch failed:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchWeather();
    const interval = setInterval(fetchWeather, 30 * 60 * 1000); // Update every 30 mins
    return () => clearInterval(interval);
  }, []);

  const getWeatherIcon = (code: number) => {
    if (code === 0) return <Sun className="text-amber-500" size={24} />;
    if (code <= 3) return <Cloud className="text-zinc-400" size={24} />;
    if (code <= 48) return <Wind className="text-zinc-400" size={24} />;
    if (code <= 67) return <CloudRain className="text-blue-500" size={24} />;
    if (code <= 77) return <CloudSnow className="text-blue-300" size={24} />;
    if (code <= 82) return <CloudRain className="text-blue-600" size={24} />;
    if (code <= 86) return <CloudSnow className="text-blue-400" size={24} />;
    return <CloudLightning className="text-purple-500" size={24} />;
  };

  const getWeatherDesc = (code: number) => {
    if (code === 0) return "Clear Sky";
    if (code <= 3) return "Partly Cloudy";
    if (code <= 48) return "Foggy";
    if (code <= 67) return "Rainy";
    if (code <= 77) return "Snowy";
    if (code <= 82) return "Showers";
    if (code <= 86) return "Snow Showers";
    return "Thunderstorm";
  };

  if (loading) return (
    <div className="bg-white rounded-3xl p-6 shadow-sm border border-zinc-100 animate-pulse flex items-center gap-4">
      <div className="w-10 h-10 bg-zinc-100 rounded-xl" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-zinc-100 rounded w-1/2" />
        <div className="h-3 bg-zinc-100 rounded w-1/3" />
      </div>
    </div>
  );

  if (!weather) return null;

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm border border-zinc-100 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="p-3 bg-zinc-50 rounded-2xl">
          {getWeatherIcon(weather.code)}
        </div>
        <div>
          <h3 className="text-sm font-bold text-zinc-900">Riga, LV</h3>
          <p className="text-xs text-zinc-500">{getWeatherDesc(weather.code)}</p>
        </div>
      </div>
      <div className="text-right">
        <span className="text-2xl font-bold text-zinc-900">{weather.temp}°C</span>
      </div>
    </div>
  );
}

// --- AI Assistant Component ---

interface AIAssistantProps {
  user: User;
}

function AIAssistant({ user }: AIAssistantProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  const addEventAI = async (summary: string, date: string, time: string) => {
    const start = new Date(`${date}T${time}`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    await addDoc(collection(db, `users/${user.uid}/events`), {
      summary,
      start,
      end,
      createdAt: serverTimestamp()
    });
    return `Event "${summary}" added for ${date} at ${time}.`;
  };

  const addAlarmAI = async (time: string, label: string) => {
    await addDoc(collection(db, `users/${user.uid}/alarms`), {
      time,
      label,
      enabled: true,
      days: [0, 1, 2, 3, 4, 5, 6],
      createdAt: serverTimestamp()
    });
    return `Alarm set for ${time}${label ? ` with label "${label}"` : ''}.`;
  };

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsTyping(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      const addEventTool: FunctionDeclaration = {
        name: "addEvent",
        parameters: {
          type: Type.OBJECT,
          description: "Add a new event to the calendar.",
          properties: {
            summary: { type: Type.STRING, description: "The title of the event." },
            date: { type: Type.STRING, description: "The date in YYYY-MM-DD format." },
            time: { type: Type.STRING, description: "The time in HH:mm format." },
          },
          required: ["summary", "date", "time"],
        },
      };

      const addAlarmTool: FunctionDeclaration = {
        name: "addAlarm",
        parameters: {
          type: Type.OBJECT,
          description: "Set a new alarm.",
          properties: {
            time: { type: Type.STRING, description: "The time in HH:mm format." },
            label: { type: Type.STRING, description: "An optional label for the alarm." },
          },
          required: ["time"],
        },
      };

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: userMessage,
        config: {
          systemInstruction: `You are a helpful calendar and alarm assistant. 
          Today is ${format(new Date(), 'PPPP')}. 
          If the user wants to add an event or set an alarm, use the provided tools. 
          Be concise and friendly.`,
          tools: [{ functionDeclarations: [addEventTool, addAlarmTool] }],
        },
      });

      const functionCalls = response.functionCalls;
      if (functionCalls) {
        let aiResponseText = "";
        for (const call of functionCalls) {
          if (call.name === "addEvent") {
            const { summary, date, time } = call.args as any;
            aiResponseText += await addEventAI(summary, date, time) + " ";
          } else if (call.name === "addAlarm") {
            const { time, label } = call.args as any;
            aiResponseText += await addAlarmAI(time, label || "") + " ";
          }
        }
        setMessages(prev => [...prev, { role: 'ai', text: aiResponseText.trim() || "Done!" }]);
      } else {
        setMessages(prev => [...prev, { role: 'ai', text: response.text || "I'm not sure how to help with that." }]);
      }
    } catch (error) {
      console.error("AI Error:", error);
      setMessages(prev => [...prev, { role: 'ai', text: "Sorry, I encountered an error. Please try again." }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl p-6 shadow-sm border border-zinc-100 flex flex-col h-[400px]">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-purple-50 rounded-lg">
          <Sparkles className="text-purple-600" size={20} />
        </div>
        <h3 className="text-lg font-semibold">AI Assistant</h3>
      </div>
      
      <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2 scrollbar-hide">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-400 text-center mt-10">
            Ask me to "Set an alarm for 7 AM" or "Add a meeting tomorrow at 2 PM"
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={cn(
            "max-w-[85%] p-3 rounded-2xl text-sm",
            msg.role === 'user' 
              ? "bg-zinc-100 text-zinc-900 self-end ml-auto" 
              : "bg-purple-50 text-purple-900 self-start"
          )}>
            {msg.text}
          </div>
        ))}
        {isTyping && (
          <div className="bg-purple-50 text-purple-900 p-3 rounded-2xl self-start flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-xs">Thinking...</span>
          </div>
        )}
      </div>

      <div className="relative">
        <input 
          type="text" 
          placeholder="Type a request..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          className="w-full bg-zinc-50 border-none rounded-xl p-3 pr-12 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
        />
        <button 
          onClick={handleSend}
          disabled={isTyping}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-purple-600 hover:bg-purple-100 rounded-lg transition-colors disabled:opacity-50"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showAlarmModal, setShowAlarmModal] = useState(false);
  const [newAlarmTime, setNewAlarmTime] = useState('08:00');
  const [newAlarmLabel, setNewAlarmLabel] = useState('');
  const [activeAlarm, setActiveAlarm] = useState<Alarm | null>(null);
  const [lastTriggeredMinute, setLastTriggeredMinute] = useState<string>('');
  const [showEventModal, setShowEventModal] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [newEventSummary, setNewEventSummary] = useState('');
  const [newEventDate, setNewEventDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [newEventTime, setNewEventTime] = useState('12:00');

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // --- Auth & Data ---

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return;

    const alarmsQ = query(collection(db, `users/${user.uid}/alarms`), orderBy('time', 'asc'));
    const unsubscribeAlarms = onSnapshot(alarmsQ, (snapshot) => {
      const alarmList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Alarm[];
      setAlarms(alarmList);
    });

    const eventsQ = query(collection(db, `users/${user.uid}/events`), orderBy('start', 'asc'));
    const unsubscribeEvents = onSnapshot(eventsQ, (snapshot) => {
      const eventList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as CalendarEvent[];
      setEvents(eventList);
    });

    return () => {
      unsubscribeAlarms();
      unsubscribeEvents();
    };
  }, [user]);

  const handleLogin = async () => {
    setLoginError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error("Login failed:", error);
      if (error.code === 'auth/popup-blocked') {
        setLoginError("Popup was blocked by your browser. Please allow popups for this site.");
      } else if (error.code === 'auth/unauthorized-domain') {
        setLoginError("This domain is not authorized for Google Login. Please contact support.");
      } else {
        setLoginError(error.message || "Login failed. Please try again.");
      }
    }
  };

  const handleLogout = () => {
    signOut(auth);
  };

  // --- Alarm Logic ---

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const currentTime = format(now, 'HH:mm');
      const currentDay = now.getDay();
      const currentMinuteKey = `${currentTime}-${currentDay}`;

      if (lastTriggeredMinute === currentMinuteKey) return;

      alarms.forEach(alarm => {
        if (alarm.enabled && alarm.time === currentTime && alarm.days.includes(currentDay)) {
          triggerAlarm(alarm);
          setLastTriggeredMinute(currentMinuteKey);
        }
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [alarms, lastTriggeredMinute]);

  const triggerAlarm = (alarm: Alarm) => {
    setActiveAlarm(alarm);
    if (Notification.permission === 'granted') {
      new Notification(`Alarm: ${alarm.label || 'Wake up!'}`, {
        body: `It's ${alarm.time}`,
        icon: '/favicon.ico'
      });
    }
    // Play sound
    if (audioRef.current) {
      audioRef.current.play().catch(e => console.error("Audio play failed:", e));
    }
  };

  const stopAlarm = () => {
    setActiveAlarm(null);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  const addAlarm = async () => {
    if (!user) return;
    await addDoc(collection(db, `users/${user.uid}/alarms`), {
      time: newAlarmTime,
      label: newAlarmLabel,
      enabled: true,
      days: [0, 1, 2, 3, 4, 5, 6],
      createdAt: serverTimestamp()
    });
    setShowAlarmModal(false);
    setNewAlarmLabel('');
  };

  const toggleAlarm = async (alarm: Alarm) => {
    if (!user) return;
    await updateDoc(doc(db, `users/${user.uid}/alarms`, alarm.id), {
      enabled: !alarm.enabled
    });
  };

  const deleteAlarm = async (id: string) => {
    if (!user) return;
    await deleteDoc(doc(db, `users/${user.uid}/alarms`, id));
  };

  const addEvent = async () => {
    if (!user || !newEventSummary) return;
    
    const start = new Date(`${newEventDate}T${newEventTime}`);
    const end = new Date(start.getTime() + 60 * 60 * 1000); // +1 hour

    try {
      await addDoc(collection(db, `users/${user.uid}/events`), {
        summary: newEventSummary,
        start: start,
        end: end,
        createdAt: serverTimestamp()
      });
      setShowEventModal(false);
      setNewEventSummary('');
    } catch (error) {
      console.error("Error adding event:", error);
    }
  };

  // --- Calendar Rendering ---

  const renderHeader = () => (
    <div className="flex items-center justify-between mb-8">
      <div className="flex items-center gap-4">
        <h2 className="text-3xl font-light tracking-tight text-zinc-900">
          {format(currentMonth, 'MMMM yyyy')}
        </h2>
        <div className="flex gap-1">
          <button 
            onClick={() => setCurrentMonth(new Date())}
            className="px-3 py-1 text-sm font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors mr-2"
          >
            Today
          </button>
          <button 
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <button 
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button 
          onClick={() => setShowEventModal(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors"
        >
          <Plus size={16} />
          Add Event
        </button>
        <button 
          onClick={handleLogout}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </div>
  );

  const renderDays = () => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return (
      <div className="grid grid-cols-7 mb-2">
        {days.map(day => (
          <div key={day} className="text-center text-xs font-semibold text-zinc-400 uppercase tracking-wider py-2">
            {day}
          </div>
        ))}
      </div>
    );
  };

  const renderCells = () => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const rows = [];
    let days = [];
    let day = startDate;

    while (day <= endDate) {
      for (let i = 0; i < 7; i++) {
        const cloneDay = day;
        const dayEvents = events.filter(event => {
          const startDate = event.start?.toDate ? event.start.toDate() : null;
          return startDate && isSameDay(startDate, cloneDay);
        });

        days.push(
          <div
            key={day.toString()}
            className={cn(
              "min-h-[120px] border-t border-r border-zinc-100 p-2 transition-colors cursor-pointer hover:bg-zinc-50/50",
              !isSameMonth(day, monthStart) && "bg-zinc-50/30 text-zinc-300",
              isSameDay(day, selectedDate) && "bg-blue-50/30",
              i === 0 && "border-l"
            )}
            onClick={() => setSelectedDate(cloneDay)}
          >
            <div className="flex justify-between items-start mb-1">
              <span className={cn(
                "text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full",
                isToday(day) ? "bg-blue-600 text-white" : "text-zinc-700"
              )}>
                {format(day, 'd')}
              </span>
            </div>
            <div className="space-y-1 overflow-hidden">
              {dayEvents.slice(0, 3).map(event => (
                <div 
                  key={event.id} 
                  className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded truncate font-medium"
                  title={event.summary}
                >
                  {event.summary}
                </div>
              ))}
              {dayEvents.length > 3 && (
                <div className="text-[10px] text-zinc-400 pl-1">
                  + {dayEvents.length - 3} more
                </div>
              )}
            </div>
          </div>
        );
        day = addDays(day, 1);
      }
      rows.push(
        <div className="grid grid-cols-7" key={day.toString()}>
          {days}
        </div>
      );
      days = [];
    }
    return <div className="border-b border-zinc-100">{rows}</div>;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-900"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-3xl shadow-xl shadow-zinc-200/50 p-10 text-center"
        >
          <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <CalendarIcon className="text-blue-600" size={32} />
          </div>
          <h1 className="text-2xl font-semibold text-zinc-900 mb-2">Welcome Back</h1>
          <p className="text-zinc-500 mb-8">Sign in with Google to sync your calendar and manage your alarms.</p>
          
          {loginError && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3 text-left">
              <AlertCircle className="text-red-600 shrink-0" size={18} />
              <p className="text-xs text-red-800 leading-relaxed">{loginError}</p>
            </div>
          )}

          <button 
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 bg-zinc-900 text-white py-4 rounded-2xl font-medium hover:bg-zinc-800 transition-all active:scale-[0.98]"
          >
            <LogIn size={20} />
            Continue with Google
          </button>
          
          <p className="mt-6 text-[10px] text-zinc-400 uppercase tracking-widest">
            Make sure to allow popups in your browser
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans selection:bg-blue-100">
      <audio ref={audioRef} src="https://assets.mixkit.co/active_storage/sfx/1014/1014-preview.mp3" />
      
      <div className="max-w-[1400px] mx-auto p-6 lg:p-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          
          {/* Sidebar: Alarms */}
          <div className="lg:col-span-4 space-y-8">
            {/* Weather Widget */}
            <WeatherWidget />

            <div className="bg-white rounded-3xl p-8 shadow-sm border border-zinc-100">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-50 rounded-lg">
                    <Clock className="text-orange-600" size={20} />
                  </div>
                  <h3 className="text-xl font-semibold">Alarms</h3>
                </div>
                <button 
                  onClick={() => setShowAlarmModal(true)}
                  className="p-2 bg-zinc-900 text-white rounded-xl hover:bg-zinc-800 transition-colors"
                >
                  <Plus size={20} />
                </button>
              </div>

              <div className="space-y-4">
                {alarms.length === 0 ? (
                  <div className="text-center py-10 text-zinc-400">
                    <p className="text-sm">No alarms set</p>
                  </div>
                ) : (
                  alarms.map(alarm => (
                    <div 
                      key={alarm.id}
                      className={cn(
                        "group p-4 rounded-2xl border transition-all",
                        alarm.enabled ? "bg-white border-zinc-200 shadow-sm" : "bg-zinc-50 border-transparent opacity-60"
                      )}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-2xl font-bold tracking-tight">{alarm.time}</span>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => toggleAlarm(alarm)}
                            className={cn(
                              "p-2 rounded-lg transition-colors",
                              alarm.enabled ? "text-orange-600 hover:bg-orange-50" : "text-zinc-400 hover:bg-zinc-200"
                            )}
                          >
                            {alarm.enabled ? <Bell size={18} /> : <BellOff size={18} />}
                          </button>
                          <button 
                            onClick={() => deleteAlarm(alarm.id)}
                            className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                      <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                        {alarm.label || 'Alarm'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Upcoming Events List */}
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-zinc-100">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <CalendarIcon className="text-blue-600" size={20} />
                </div>
                <h3 className="text-xl font-semibold">Upcoming</h3>
              </div>
              <div className="space-y-4">
                {events.length === 0 ? (
                  <div className="text-center py-10 text-zinc-400">
                    <p className="text-sm">No upcoming events</p>
                  </div>
                ) : (
                  events.slice(0, 5).map(event => (
                    <div key={event.id} className="flex gap-4 p-3 rounded-2xl hover:bg-zinc-50 transition-colors">
                      <div className="flex-shrink-0 w-12 h-12 bg-zinc-100 rounded-xl flex flex-col items-center justify-center text-zinc-600">
                        <span className="text-[10px] font-bold uppercase">{format(event.start?.toDate ? event.start.toDate() : new Date(), 'MMM')}</span>
                        <span className="text-lg font-bold leading-none">{format(event.start?.toDate ? event.start.toDate() : new Date(), 'd')}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold text-zinc-900 truncate">{event.summary}</h4>
                        <p className="text-xs text-zinc-500">
                          {event.start?.toDate ? format(event.start.toDate(), 'p') : ''}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* AI Assistant */}
            {user && <AIAssistant user={user} />}
          </div>

          {/* Main Content: Calendar */}
          <div className="lg:col-span-8">
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-zinc-100">
              {renderHeader()}
              {renderDays()}
              {renderCells()}
            </div>
          </div>
        </div>
      </div>

      {/* Event Modal */}
      <AnimatePresence>
        {showEventModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEventModal(false)}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-8"
            >
              <h3 className="text-xl font-semibold mb-6">Add Calendar Event</h3>
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Event Name</label>
                  <input 
                    type="text" 
                    placeholder="Meeting, Birthday, etc."
                    value={newEventSummary}
                    onChange={(e) => setNewEventSummary(e.target.value)}
                    className="w-full bg-zinc-50 border-none rounded-2xl p-4 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Date</label>
                    <input 
                      type="date" 
                      value={newEventDate}
                      onChange={(e) => setNewEventDate(e.target.value)}
                      className="w-full bg-zinc-50 border-none rounded-2xl p-4 focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Time</label>
                    <input 
                      type="time" 
                      value={newEventTime}
                      onChange={(e) => setNewEventTime(e.target.value)}
                      className="w-full bg-zinc-50 border-none rounded-2xl p-4 focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => setShowEventModal(false)}
                    className="flex-1 py-4 rounded-2xl font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={addEvent}
                    className="flex-1 py-4 rounded-2xl font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    Add Event
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Alarm Modal */}
      <AnimatePresence>
        {showAlarmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAlarmModal(false)}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-8"
            >
              <h3 className="text-xl font-semibold mb-6">Set New Alarm</h3>
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Time</label>
                  <input 
                    type="time" 
                    value={newAlarmTime}
                    onChange={(e) => setNewAlarmTime(e.target.value)}
                    className="w-full text-4xl font-bold bg-zinc-50 border-none rounded-2xl p-4 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Label</label>
                  <input 
                    type="text" 
                    placeholder="Wake up, Gym, etc."
                    value={newAlarmLabel}
                    onChange={(e) => setNewAlarmLabel(e.target.value)}
                    className="w-full bg-zinc-50 border-none rounded-2xl p-4 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => setShowAlarmModal(false)}
                    className="flex-1 py-4 rounded-2xl font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={addAlarm}
                    className="flex-1 py-4 rounded-2xl font-medium bg-zinc-900 text-white hover:bg-zinc-800 transition-colors"
                  >
                    Set Alarm
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Active Alarm Overlay */}
      <AnimatePresence>
        {activeAlarm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-orange-600">
            <motion.div 
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-center text-white"
            >
              <motion.div 
                animate={{ rotate: [0, -10, 10, -10, 10, 0] }}
                transition={{ repeat: Infinity, duration: 0.5 }}
                className="mb-8"
              >
                <Bell size={120} strokeWidth={1} />
              </motion.div>
              <h2 className="text-6xl font-bold mb-4">{activeAlarm.time}</h2>
              <p className="text-2xl font-medium mb-12 opacity-90">{activeAlarm.label || 'Time to wake up!'}</p>
              <button 
                onClick={stopAlarm}
                className="bg-white text-orange-600 px-12 py-6 rounded-3xl text-2xl font-bold hover:bg-zinc-100 transition-all active:scale-95 shadow-xl"
              >
                Stop Alarm
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
