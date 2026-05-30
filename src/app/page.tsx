"use client";

import React, { useState, useEffect, useRef } from "react";

// Google GSI Types global declaration to prevent build errors
declare global {
  interface Window {
    google?: any;
  }
}

// Types
interface QuestionField {
  id: string;
  type: "text" | "textarea" | "checkbox" | "radio" | "dropdown";
  label: string;
  required: boolean;
  options: string[]; // Options for choices
}

interface Sticker { // Kept variable name 'Sticker' to keep database sync perfectly intact! Renders as Geometric Gems.
  id: string;
  type: string; // sphere, torus, pyramid, prism, capsule, cone
  x: number;    // % relative to zine-sheet width
  y: number;    // % relative to zine-sheet height
  rotation: number;
}

interface FormResponse {
  id: string;
  form_id: string;
  answers: Record<string, any>;
  created_at: string;
}

interface GoogleUser {
  name: string;
  email: string;
  picture: string; // Real Google profile picture URL or letter avatar
}

// Preset Google Accounts for our high-fidelity Sandbox Account Chooser
const MOCK_GOOGLE_ACCOUNTS = [
  { name: "Rebel Admin", email: "admin@gmail.com", picture: "A", color: "#8b5cf6" },
  { name: "Hype Creator", email: "hype.creator@gmail.com", picture: "H", color: "#ec4899" },
  { name: "Cyber Artist", email: "cyber.artist@gmail.com", picture: "C", color: "#38bdf8" }
];

// Helper to render beautiful circular Google avatars (URL or letter fallback)
const renderAvatar = (picture: string | undefined, name: string, sizeClass = "w-6 h-6 text-[10px]") => {
  const pic = picture || "G";
  const isUrl = pic.startsWith("http://") || pic.startsWith("https://");
  if (isUrl) {
    return (
      <img
        src={pic}
        alt={name}
        className={`${sizeClass} rounded-full object-cover border border-white/10`}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div className={`${sizeClass} rounded-full bg-purple-500 text-black flex items-center justify-center font-black uppercase font-mono shadow-inner`}>
      {pic.charAt(0)}
    </div>
  );
};

// Unique time-based reference ID generator
const timeStringID = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export default function Home() {
  // --- AUTH & GOOGLE DUAL ACTOR STATE ---
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<"admin" | "guest" | null>(null);
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null);
  const [googleSelectorOpen, setGoogleSelectorOpen] = useState<boolean>(false);
  const [googleClientId, setGoogleClientId] = useState<string>("470194305778-sg7d465h1m42tuqk2487auegnjr7rub9.apps.googleusercontent.com");
  const [isRealAuthActive, setIsRealAuthActive] = useState<boolean>(true);
  const [showConfigPanel, setShowConfigPanel] = useState<boolean>(false);
  
  // Custom Google sign in inputs
  const [customName, setCustomName] = useState<string>("");
  const [customEmail, setCustomEmail] = useState<string>("");

  // Submissions dashboard state
  const [viewingResponses, setViewingResponses] = useState<boolean>(false);
  const [responsesList, setResponsesList] = useState<FormResponse[]>([]);
  const [loadingResponses, setLoadingResponses] = useState<boolean>(false);

  // --- CORE SYSTEM STATE ---
  const [mode, setMode] = useState<"build" | "fill">("build");
  const [formId, setFormId] = useState<string>("");
  const [formCreatorEmail, setFormCreatorEmail] = useState<string>("");
  const [title, setTitle] = useState<string>("FLUID MOTION LABS");
  const [description, setDescription] = useState<string>("EXPERIMENT REGISTRATION CARD");
  
  // Dashboard & Collaborators State
  const [dashboardView, setDashboardView] = useState<boolean>(true);
  const [formsList, setFormsList] = useState<any[]>([]);
  const [loadingForms, setLoadingForms] = useState<boolean>(false);
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const [inviteEmail, setInviteEmail] = useState<string>("");
  
  const [questions, setQuestions] = useState<QuestionField[]>([
    {
      id: "q-alias",
      type: "text",
      label: "CREATOR ALIAS / TAG",
      required: true,
      options: []
    },
    {
      id: "q-vibe",
      type: "radio",
      label: "SELECT YOUR MOTION DIMENSION",
      required: true,
      options: ["Fluid Dynamics", "Kinetic Typography", "3D Geometry", "Abstract Glassmorphism"]
    }
  ]);

  const [stickers, setStickers] = useState<Sticker[]>([]);

  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [successGlow, setSuccessGlow] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Backend connection status
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(false);

  // Refs
  const canvasRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Sleek logger for the console
  const logTerminal = (msg: string) => {
    console.log(`%c[FLUID MOTION]%c ${msg}`, "color: #a855f7; font-weight: bold", "color: #fafafa");
  };

  // --- DASHBOARD LOADER & REST CLIENTS ---
  const loadFormsList = async (userEmail: string) => {
    if (!userEmail) return;
    setLoadingForms(true);
    // Make sure we check connectivity first
    try {
      const res = await fetch(`${API_URL}/api/forms?email=${encodeURIComponent(userEmail)}`);
      if (res.ok) {
        const data = await res.json();
        setFormsList(data || []);
        logTerminal(`Loaded ${data.length} forms for dashboard from PostgreSQL.`);
      }
    } catch (err) {
      logTerminal("Go backend not detected or database offline. Restoring cache.");
      // Fallback local form list
      const localForm = localStorage.getItem("rebel_zine_form");
      if (localForm) {
        try {
          const parsed = JSON.parse(localForm);
          setFormsList([{
            id: "local",
            title: parsed.title || "Local Form",
            description: parsed.description || "Saved locally in sandbox",
            fields: parsed.fields || [],
            stickers: parsed.stickers || [],
            creator_email: userEmail,
            collaborators: [],
            created_at: new Date().toISOString()
          }]);
        } catch (e) {}
      }
    }
    setLoadingForms(false);
  };

  // --- DYNAMIC PERMISSION & ROLE ROUTING ENGINE ---
  useEffect(() => {
    if (!googleUser) {
      setUserRole(null);
      return;
    }

    const userEmail = googleUser.email.toLowerCase();
    const creatorEmailNormalized = formCreatorEmail.toLowerCase();
    
    // Check parameters for active formId
    const params = new URLSearchParams(window.location.search);
    const activeFormId = params.get("formId") || formId;

    if (!activeFormId) {
      // 1. Land on Dashboard
      setDashboardView(true);
      setUserRole("admin");
      loadFormsList(googleUser.email);
      logTerminal(`User ${googleUser.email} landed on Dashboard view.`);
    } else {
      // 2. Existing form loaded - Check ownership or collaboration rights
      setDashboardView(false);
      const isOwner = userEmail === creatorEmailNormalized;
      const isCollaborator = collaborators.some(c => c.toLowerCase() === userEmail);
      const isHistoricalAdmin = creatorEmailNormalized === "" && (userEmail === "laestrodong@gmail.com" || userEmail === "admin@gmail.com");

      if (isOwner || isCollaborator || isHistoricalAdmin) {
        setUserRole("admin");
        // Retain mode so owner/collaborator can toggle between build and run preview modes
        setMode((prev) => (prev === "fill" ? "fill" : "build"));
        logTerminal(`Admin privileges verified (Owner/Collaborator) for form ${activeFormId} for: ${googleUser.email}`);
      } else {
        setUserRole("guest");
        setMode("fill");
        // Auto-populate alias text field using Google Name! (Google Forms Style)
        setAnswers((prev) => ({
          ...prev,
          "q-alias": googleUser.name.toUpperCase(),
          "google_user": googleUser
        }));
        logTerminal(`Respondent access locked in Fill Mode for form ${activeFormId} for: ${googleUser.email}`);
      }
    }
  }, [googleUser, formCreatorEmail, collaborators, formId]);

  // --- DYNAMIC GOOGLE CLIENT SDK LOADER & SESSION RESTORE ---
  useEffect(() => {
    // 1. Inject official Google Identity Services SDK script
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);

    // 2. Load Client ID config from localStorage on load, fallback to your real default Client ID
    const savedId = localStorage.getItem("rebel_google_client_id") || "470194305778-sg7d465h1m42tuqk2487auegnjr7rub9.apps.googleusercontent.com";
    setGoogleClientId(savedId);
    if (savedId) {
      setIsRealAuthActive(true);
    }

    // 3. Restore cached authentic session if available
    const cachedUser = localStorage.getItem("rebel_google_user");
    if (cachedUser) {
      try {
        const parsed = JSON.parse(cachedUser) as GoogleUser;
        setGoogleUser(parsed);
        setIsLoggedIn(true);
        logTerminal(`Restored authentic Google session: ${parsed.email}`);
      } catch (e) {
        // ignore
      }
    }

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  // --- INITIALIZE REAL GOOGLE SIGN-IN IF CLIENT ID IS ACTIVE ---
  useEffect(() => {
    if (!googleClientId || !isRealAuthActive || isLoggedIn) return;

    const initGsi = () => {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: handleCredentialResponse,
          auto_select: false,
        });

        const btnContainer = document.getElementById("official-google-btn-container");
        if (btnContainer) {
          window.google.accounts.id.renderButton(btnContainer, {
            theme: "filled_dark",
            size: "large",
            shape: "pill",
            width: "300",
          });
        } else {
          setTimeout(initGsi, 100);
        }
      } else {
        setTimeout(initGsi, 100);
      }
    };

    initGsi();
  }, [googleClientId, isRealAuthActive, isLoggedIn]);

  // --- LUXURY AUDIO SYNTH ENGINE (Web Audio API) ---
  const initAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  };

  const playOrganicClick = () => {
    initAudio();
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(160, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.05);

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.05);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  };

  const playChime = () => {
    initAudio();
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const playTone = (freq: number, volume: number, decay: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + decay);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + decay);
    };

    playTone(650, 0.08, 0.22);
    playTone(950, 0.06, 0.18);
    playTone(1300, 0.05, 0.15);
  };

  const playSoftWhoosh = () => {
    initAudio();
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const bufferSize = ctx.sampleRate * 0.35; // 350ms
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(200, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.15);
    filter.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.35);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.15);
    gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start();
    noise.stop(ctx.currentTime + 0.35);
  };

  const playSuccessSweep = () => {
    initAudio();
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const playHarmonic = (freq: number, delay: number, volume: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      
      gain.gain.setValueAtTime(0.001, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + delay + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.6);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.6);
    };

    playHarmonic(523.25, 0, 0.08);     // C5
    playHarmonic(659.25, 0.08, 0.07);  // E5
    playHarmonic(783.99, 0.16, 0.06);  // G5
    playHarmonic(987.77, 0.24, 0.05);  // B5
  };

  // --- GOOGLE SIGN IN MECHANISMS ---
  const handleCredentialResponse = (response: any) => {
    try {
      const credential = response.credential;
      const base64Url = credential.split(".")[1];
      const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
      const jsonPayload = decodeURIComponent(
        window.atob(base64)
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      );
      const payload = JSON.parse(jsonPayload);
      
      if (payload && payload.email) {
        logTerminal(`Authenticated via real Google Account: ${payload.email}`);
        
        const authenticatedUser: GoogleUser = {
          name: payload.name || "Google User",
          email: payload.email,
          picture: payload.picture || "G"
        };
        
        // Cache the session in localStorage
        localStorage.setItem("rebel_google_user", JSON.stringify(authenticatedUser));
        
        // Check if admin
        setGoogleUser(authenticatedUser);
        setIsLoggedIn(true);
        playSuccessSweep();
      }
    } catch (error) {
      console.error("Failed to parse real Google credential", error);
      alert("Authentic Google Login failed to parse. Please try again.");
    }
  };

  const triggerGoogleLogin = () => {
    playOrganicClick();
    setGoogleSelectorOpen(true);
  };

  const selectGoogleAccount = (name: string, email: string, initial: string) => {
    initAudio();
    playSuccessSweep();
    
    // Clear any real Google cached session first
    localStorage.removeItem("rebel_google_user");

    const selectedUser = {
      name,
      email,
      picture: initial
    };

    setGoogleUser(selectedUser);
    setGoogleSelectorOpen(false);
    setIsLoggedIn(true);

    // Role division is evaluated dynamically by useEffect hook
    logTerminal(`Google User Logged In in Sandbox Mode: ${email}`);
  };

  const submitCustomGoogleAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (customName.trim() === "" || customEmail.trim() === "") return;
    
    const initial = customName.trim().charAt(0).toUpperCase();
    selectGoogleAccount(customName.trim(), customEmail.trim().toLowerCase(), initial);
    
    setCustomName("");
    setCustomEmail("");
  };

  const handleLogout = () => {
    playSoftWhoosh();
    setIsLoggedIn(false);
    setUserRole(null);
    setGoogleUser(null);
    setAnswers({});
    setIsSubmitted(false);
    setSuccessGlow(false);
    setViewingResponses(false);
    localStorage.removeItem("rebel_google_user");
    logTerminal("Google session cleared.");
  };

  // --- SUBMISSIONS FEED LOADER (Admin Only) ---
  const loadSubmissions = async () => {
    playOrganicClick();
    setViewingResponses(true);
    setLoadingResponses(true);

    if (isBackendConnected && formId) {
      try {
        const res = await fetch(`${API_URL}/api/forms/${formId}/responses`);
        if (res.ok) {
          const data = await res.json();
          setResponsesList(data || []);
          logTerminal(`Fetched ${data.length} responses from PostgreSQL.`);
          setLoadingResponses(false);
          return;
        }
      } catch (err) {
        logTerminal("Failed fetching live responses from Go backend.");
      }
    }

    // Fallback: Read from LocalStorage
    setTimeout(() => {
      const allSubmissions = JSON.parse(localStorage.getItem("rebel_zine_responses") || "[]");
      const targetId = formId || "local";
      const filtered = allSubmissions
        .filter((sub: any) => sub.formId === targetId)
        .map((sub: any) => ({
          id: sub.id,
          form_id: sub.formId,
          answers: sub.answers,
          created_at: sub.timestamp
        }));
      
      setResponsesList(filtered);
      logTerminal(`Restored ${filtered.length} local submissions.`);
      setLoadingResponses(false);
    }, 400);
  };

  // --- SINGLE RESPONSE HIGH-FIDELITY PRINT EXPORT ---
  const printSingleResponse = (resp: FormResponse, aliasVal: string, userMeta: GoogleUser | null) => {
    playOrganicClick();
    
    // 1. Create temporary iframe
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);
    
    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (!doc) return;
    
    // 2. Build gorgeous, print-optimized document markup
    let answersHtml = "";
    Object.entries(resp.answers)
      .filter(([key]) => key !== "google_user")
      .map(([key, val]) => {
        const matchingQ = questions.find(q => q.id === key);
        const labelText = matchingQ ? matchingQ.label : key;
        const ansStr = Array.isArray(val) ? val.join(", ") : val;
        answersHtml += `
          <div class="field-item">
            <div class="field-label">${labelText}</div>
            <div class="field-value">${ansStr || "N/A"}</div>
          </div>
        `;
      });

    const htmlContent = `
      <html>
        <head>
          <title>Response_${resp.id.substring(0,8)}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;700;900&family=Inter:wght@400;600;800&display=swap');
            body {
              background: #09090b;
              color: #f4f4f5;
              font-family: 'Inter', sans-serif;
              margin: 0;
              padding: 40px;
            }
            .receipt-card {
              max-width: 500px;
              margin: 0 auto;
              border: 1px solid rgba(255,255,255,0.1);
              background: rgba(255,255,255,0.02);
              border-radius: 24px;
              padding: 32px;
              box-shadow: 0 20px 40px rgba(0,0,0,0.5);
            }
            .header {
              text-align: center;
              border-bottom: 1px solid rgba(255,255,255,0.1);
              padding-bottom: 24px;
              margin-bottom: 24px;
            }
            .app-title {
              font-family: 'Outfit', sans-serif;
              font-size: 24px;
              font-weight: 900;
              letter-spacing: 1px;
              color: #ffffff;
              text-transform: uppercase;
              margin: 0;
            }
            .sub-title {
              font-size: 9px;
              color: #a1a1aa;
              letter-spacing: 2px;
              text-transform: uppercase;
              margin-top: 6px;
              font-weight: 700;
              font-family: 'Outfit', sans-serif;
            }
            .meta-info {
              font-size: 8.5px;
              font-family: monospace;
              color: #71717a;
              margin-top: 12px;
              line-height: 1.6;
            }
            .avatar-section {
              display: flex;
              align-items: center;
              gap: 12px;
              margin-top: 16px;
              justify-content: center;
              text-align: left;
            }
            .avatar-circle {
              width: 32px;
              height: 32px;
              border-radius: 50%;
              background: #a855f7;
              color: #000;
              display: flex;
              align-items: center;
              justify-content: center;
              font-weight: 900;
              font-size: 13px;
            }
            .avatar-img {
              width: 32px;
              height: 32px;
              border-radius: 50%;
              object-fit: cover;
              border: 1px solid rgba(255,255,255,0.1);
            }
            .avatar-text {
              display: flex;
              flex-direction: column;
            }
            .avatar-name {
              font-size: 11px;
              font-weight: 800;
              color: #e4e4e7;
            }
            .avatar-email {
              font-size: 8px;
              color: #71717a;
              font-family: monospace;
            }
            .field-item {
              border-bottom: 1px solid rgba(255,255,255,0.05);
              padding-bottom: 12px;
              margin-bottom: 16px;
            }
            .field-label {
              font-size: 9px;
              font-weight: 700;
              color: #71717a;
              letter-spacing: 1px;
              text-transform: uppercase;
            }
            .field-value {
              font-size: 12px;
              color: #ffffff;
              margin-top: 6px;
              background: rgba(255,255,255,0.03);
              border: 1px solid rgba(255,255,255,0.03);
              padding: 10px;
              border-radius: 12px;
              font-style: italic;
            }
            .footer {
              border-top: 1px solid rgba(255,255,255,0.1);
              padding-top: 16px;
              text-align: center;
              font-size: 8px;
              color: #71717a;
              font-family: monospace;
            }
            @media print {
              body { background: #ffffff; color: #000000; padding: 0; }
              .receipt-card { border: none; box-shadow: none; padding: 0; background: none; max-width: 100%; }
              .app-title { color: #000000; }
              .field-value { background: #f4f4f5; border: 1px solid #e4e4e7; color: #000000; }
              .avatar-name { color: #000000; }
            }
          </style>
        </head>
        <body>
          <div class="receipt-card">
            <div class="header">
               <h3 class="app-title">LAH FORMULIR</h3>
               <div class="sub-title">OFFICIAL RESPONDENT RECORD</div>
               <div class="meta-info">
                 RECORD ID: #FL-${resp.id.toUpperCase()}<br />
                 SUBMIT TIME: ${new Date(resp.created_at).toLocaleString("id-ID")}
               </div>
               
               <div class="avatar-section">
                 ${userMeta?.picture && (userMeta.picture.startsWith("http://") || userMeta.picture.startsWith("https://")) 
                   ? `<img src="${userMeta.picture}" class="avatar-img" />`
                   : `<div class="avatar-circle">${aliasVal.charAt(0).toUpperCase()}</div>`
                 }
                 <div class="avatar-text">
                   <div class="avatar-name">${aliasVal}</div>
                   ${userMeta ? `<div class="avatar-email">${userMeta.email}</div>` : ""}
                 </div>
               </div>
            </div>
            
            <div class="fields-list">
              ${answersHtml}
            </div>
            
            <div class="footer">
              LAH FORMULIR SYSTEM &bull; PERSISTED IN NEON POSTGRESQL
            </div>
          </div>
          
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() {
                window.frameElement.remove();
              }, 1000);
            };
          </script>
        </body>
      </html>
    `;
    
    doc.open();
    doc.write(htmlContent);
    doc.close();
  };

  // --- MULTI-RESPONSE HIGH-FIDELITY PRINT EXPORT ALL ---
  const printAllResponses = () => {
    if (responsesList.length === 0) {
      alert("No responses available to export.");
      return;
    }
    
    playOrganicClick();
    
    // 1. Create temporary iframe
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);
    
    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (!doc) return;
    
    // 2. Build gorgeous print-optimized document markup containing ALL responses
    let allResponsesHtml = "";
    
    responsesList.forEach((resp, idx) => {
      const aliasVal = resp.answers["q-alias"] || "ANONYMOUS GUEST";
      const userMeta = resp.answers["google_user"] as GoogleUser || null;
      
      let answersHtml = "";
      Object.entries(resp.answers)
        .filter(([key]) => key !== "google_user")
        .map(([key, val]) => {
          const matchingQ = questions.find(q => q.id === key);
          const labelText = matchingQ ? matchingQ.label : key;
          const ansStr = Array.isArray(val) ? val.join(", ") : val;
          answersHtml += `
            <div class="field-item">
              <div class="field-label">${labelText}</div>
              <div class="field-value">${ansStr || "N/A"}</div>
            </div>
          `;
        });
        
      allResponsesHtml += `
        <div class="receipt-card ${idx > 0 ? 'page-break' : ''}">
          <div class="header">
             <h3 class="app-title">LAH FORMULIR</h3>
             <div class="sub-title">OFFICIAL RESPONDENT RECORD</div>
             <div class="meta-info">
               RECORD ID: #FL-${resp.id.toUpperCase()}<br />
               SUBMIT TIME: ${new Date(resp.created_at).toLocaleString("id-ID")}
             </div>
             
             <div class="avatar-section">
               ${userMeta?.picture && (userMeta.picture.startsWith("http://") || userMeta.picture.startsWith("https://")) 
                 ? `<img src="${userMeta.picture}" class="avatar-img" />`
                 : `<div class="avatar-circle">${aliasVal.charAt(0).toUpperCase()}</div>`
               }
               <div class="avatar-text">
                 <div class="avatar-name">${aliasVal}</div>
                 ${userMeta ? `<div class="avatar-email">${userMeta.email}</div>` : ""}
               </div>
             </div>
          </div>
          
          <div class="fields-list">
            ${answersHtml}
          </div>
          
          <div class="footer">
            LAH FORMULIR SYSTEM &bull; RECORD ${idx + 1} OF ${responsesList.length}
          </div>
        </div>
      `;
    });

    const htmlContent = `
      <html>
        <head>
          <title>All_Responses_${formId || 'export'}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;700;900&family=Inter:wght@400;600;800&display=swap');
            body {
              background: #09090b;
              color: #f4f4f5;
              font-family: 'Inter', sans-serif;
              margin: 0;
              padding: 40px;
            }
            .receipt-card {
              max-width: 500px;
              margin: 0 auto 40px auto;
              border: 1px solid rgba(255,255,255,0.1);
              background: rgba(255,255,255,0.02);
              border-radius: 24px;
              padding: 32px;
              box-shadow: 0 20px 40px rgba(0,0,0,0.5);
            }
            .page-break {
              page-break-before: always;
              margin-top: 40px;
            }
            .header {
              text-align: center;
              border-bottom: 1px solid rgba(255,255,255,0.1);
              padding-bottom: 24px;
              margin-bottom: 24px;
            }
            .app-title {
              font-family: 'Outfit', sans-serif;
              font-size: 24px;
              font-weight: 900;
              letter-spacing: 1px;
              color: #ffffff;
              text-transform: uppercase;
              margin: 0;
            }
            .sub-title {
              font-size: 9px;
              color: #a1a1aa;
              letter-spacing: 2px;
              text-transform: uppercase;
              margin-top: 6px;
              font-weight: 700;
              font-family: 'Outfit', sans-serif;
            }
            .meta-info {
              font-size: 8.5px;
              font-family: monospace;
              color: #71717a;
              margin-top: 12px;
              line-height: 1.6;
            }
            .avatar-section {
              display: flex;
              align-items: center;
              gap: 12px;
              margin-top: 16px;
              justify-content: center;
              text-align: left;
            }
            .avatar-circle {
              width: 32px;
              height: 32px;
              border-radius: 50%;
              background: #a855f7;
              color: #000;
              display: flex;
              align-items: center;
              justify-content: center;
              font-weight: 900;
              font-size: 13px;
            }
            .avatar-img {
              width: 32px;
              height: 32px;
              border-radius: 50%;
              object-fit: cover;
              border: 1px solid rgba(255,255,255,0.1);
            }
            .avatar-text {
              display: flex;
              flex-direction: column;
            }
            .avatar-name {
              font-size: 11px;
              font-weight: 800;
              color: #e4e4e7;
            }
            .avatar-email {
              font-size: 8px;
              color: #71717a;
              font-family: monospace;
            }
            .field-item {
              border-bottom: 1px solid rgba(255,255,255,0.05);
              padding-bottom: 12px;
              margin-bottom: 16px;
            }
            .field-label {
              font-size: 9px;
              font-weight: 700;
              color: #71717a;
              letter-spacing: 1px;
              text-transform: uppercase;
            }
            .field-value {
              font-size: 12px;
              color: #ffffff;
              margin-top: 6px;
              background: rgba(255,255,255,0.03);
              border: 1px solid rgba(255,255,255,0.03);
              padding: 10px;
              border-radius: 12px;
              font-style: italic;
            }
            .footer {
              border-top: 1px solid rgba(255,255,255,0.1);
              padding-top: 16px;
              text-align: center;
              font-size: 8px;
              color: #71717a;
              font-family: monospace;
            }
            @media print {
              body { background: #ffffff; color: #000000; padding: 0; }
              .receipt-card { border: 1px solid #e4e4e7; box-shadow: none; padding: 24px; background: none; max-width: 100%; margin-bottom: 0; }
              .page-break { page-break-before: always; margin-top: 0; }
              .app-title { color: #000000; }
              .field-value { background: #f4f4f5; border: 1px solid #e4e4e7; color: #000000; }
              .avatar-name { color: #000000; }
            }
          </style>
        </head>
        <body>
          <div class="responses-container">
            ${allResponsesHtml}
          </div>
          
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() {
                window.frameElement.remove();
              }, 1000);
            };
          </script>
        </body>
      </html>
    `;
    
    doc.open();
    doc.write(htmlContent);
    doc.close();
  };

  // --- CONNECTIVITY & LOADING FALLBACK ---
  useEffect(() => {
    const initApp = async () => {
      let isConnected = false;
      try {
        await fetch(`${API_URL}/api/forms`);
        setIsBackendConnected(true);
        isConnected = true;
      } catch (e) {
        logTerminal("Go backend not detected. Fallback to LocalStorage active.");
        setIsBackendConnected(false);
      }

      const params = new URLSearchParams(window.location.search);
      const id = params.get("formId");
      if (id) {
        setFormId(id);
        setDashboardView(false);
        try {
          const res = await fetch(`${API_URL}/api/forms/${id}`);
          if (res.ok) {
            const data = await res.json();
            setTitle(data.title);
            setDescription(data.description);
            setQuestions(data.fields);
            setStickers(data.stickers);
            setFormCreatorEmail(data.creator_email || "");
            setCollaborators(data.collaborators || []);
            logTerminal(`Successfully loaded form ${id}. Creator: ${data.creator_email}`);
          }
        } catch (err) {
          logTerminal("Failed loading form from database.");
        }
      } else {
        setDashboardView(true);
      }
    };

    initApp();
  }, []);

  // --- DASHBOARD NAVIGATION HELPERS ---
  const navigateToDashboard = () => {
    playSoftWhoosh();
    setFormId("");
    setFormCreatorEmail("");
    setCollaborators([]);
    setDashboardView(true);
    setResponsesList([]);
    setViewingResponses(false);
    window.history.pushState({}, "", window.location.pathname);
    if (googleUser) {
      loadFormsList(googleUser.email);
    }
  };

  const navigateToForm = (id: string, creator: string, collabs: string[], titleVal: string, descVal: string, fieldsVal: any[], stickersVal: any[]) => {
    playOrganicClick();
    setFormId(id);
    setFormCreatorEmail(creator);
    setCollaborators(collabs || []);
    setTitle(titleVal);
    setDescription(descVal);
    setQuestions(fieldsVal || []);
    setStickers(stickersVal || []);
    setAnswers({});
    setIsSubmitted(false);
    setSuccessGlow(false);
    setDashboardView(false);
    window.history.pushState({}, "", `?formId=${id}`);
  };

  // --- API CALLS ---
  const createNewForm = async () => {
    playOrganicClick();
    if (!googleUser) {
      alert("Please log in first to create a form.");
      return;
    }

    const payload = {
      title: "Untitled Zine Form",
      description: "Customize this registration form",
      fields: [
        {
          id: "q-alias",
          type: "text",
          label: "CREATOR ALIAS / TAG",
          required: true,
          options: []
        }
      ],
      stickers: [],
      creator_email: googleUser.email,
      collaborators: []
    };

    if (isBackendConnected) {
      try {
        const res = await fetch(`${API_URL}/api/forms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          const data = await res.json();
          navigateToForm(data.id, googleUser.email, [], data.title, data.description, data.fields, data.stickers);
          logTerminal(`Successfully created form ${data.id} in Postgres.`);
          return;
        }
      } catch (err) {
        logTerminal("Postgres form creation error. Fallback to sandbox.");
      }
    }

    // Fallback sandbox form creation
    const sandboxId = "local-" + timeStringID();
    navigateToForm(sandboxId, googleUser.email, [], payload.title, payload.description, payload.fields, payload.stickers);
    logTerminal("Created new form in Sandbox Mode (local cache only).");
  };

  const deleteForm = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    playOrganicClick();
    if (!window.confirm("Are you sure you want to delete this form design permanently? This will also delete all submitted responses!")) {
      return;
    }

    if (isBackendConnected && !id.startsWith("local")) {
      try {
        const res = await fetch(`${API_URL}/api/forms/${id}`, {
          method: "DELETE"
        });
        if (res.ok) {
          logTerminal(`Form ${id} successfully deleted from PostgreSQL database.`);
          alert("Form successfully deleted!");
          if (googleUser) {
            loadFormsList(googleUser.email);
          }
          return;
        }
      } catch (err) {
        logTerminal("Error deleting form from postgres backend.");
      }
    }

    // Fallback sandbox deletion
    logTerminal(`Form ${id} successfully deleted locally.`);
    alert("Form deleted!");
    setFormsList(prev => prev.filter(f => f.id !== id));
  };

  const copyShareLink = (id: string) => {
    playOrganicClick();
    if (typeof window === "undefined") return;
    const shareUrl = `${window.location.origin}/?formId=${id}`;
    navigator.clipboard.writeText(shareUrl)
      .then(() => {
        playChime();
        alert("Share link copied to clipboard!\nSend this link to respondents to fill out your form.");
      })
      .catch(() => {
        alert(`Failed to copy. Share this link:\n${shareUrl}`);
      });
  };

  const saveFormDesign = async () => {
    playOrganicClick();
    if (!googleUser) return;

    const payload = {
      title,
      description,
      fields: questions,
      stickers,
      creator_email: formCreatorEmail || googleUser.email,
      collaborators: collaborators
    };

    if (isBackendConnected && formId && !formId.startsWith("local")) {
      try {
        const res = await fetch(`${API_URL}/api/forms/${formId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          logTerminal(`Form ${formId} successfully updated in database.`);
          alert("Design saved and synchronized!");
          return;
        }
      } catch (err) {
        logTerminal("Error updating design on postgres backend.");
      }
    }

    localStorage.setItem("rebel_zine_form", JSON.stringify(payload));
    alert("Saved design locally! (Offline/Sandbox Mode)");
  };

  const loadForm = async (id: string) => {
    if (isBackendConnected) {
      try {
        const res = await fetch(`${API_URL}/api/forms/${id}`);
        if (res.ok) {
          const data = await res.json();
          setTitle(data.title);
          setDescription(data.description);
          setQuestions(data.fields);
          setStickers(data.stickers);
          setFormCreatorEmail(data.creator_email || "");
          setCollaborators(data.collaborators || []);
          logTerminal(`Successfully loaded form ${id}. Creator: ${data.creator_email}`);
          return;
        }
      } catch (err) {
        logTerminal(`Failed loading form ${id} from Go backend.`);
      }
    }
  };

  const handleFormSubmission = async (e: React.FormEvent) => {
    e.preventDefault();
    initAudio();

    // Verify required inputs
    for (const q of questions) {
      if (q.required && !answers[q.id] && !(q.id === "q-alias" && googleUser)) {
        alert(`Question: "${q.label}" is required.`);
        return;
      }
    }

    setSubmitting(true);
    playSuccessSweep();
    setSuccessGlow(true);

    // Save final answers (inject google metadata if logged in)
    const finalAnswers = { ...answers };
    if (googleUser) {
      finalAnswers["q-alias"] = googleUser.name.toUpperCase();
      finalAnswers["google_user"] = googleUser;
    }

    const payload = {
      answers: finalAnswers
    };

    setTimeout(async () => {
      if (isBackendConnected && formId) {
        try {
          const res = await fetch(`${API_URL}/api/forms/${formId}/responses`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            logTerminal("Submitted answers successfully saved to PostgreSQL database.");
          }
        } catch (e) {
          logTerminal("Backend error. Answers saved to client memory.");
        }
      }

      const submissions = JSON.parse(localStorage.getItem("rebel_zine_responses") || "[]");
      submissions.push({
        id: timeStringID(),
        formId: formId || "local",
        answers: finalAnswers,
        timestamp: new Date().toISOString()
      });
      localStorage.setItem("rebel_zine_responses", JSON.stringify(submissions));

      setSubmitting(false);
      setIsSubmitted(true);
    }, 850);
  };

  // --- DYNAMIC QUESTION ACTIONS (Google Forms Style) ---
  const addQuestion = (type: QuestionField["type"]) => {
    playChime();
    const newQ: QuestionField = {
      id: `q-${Date.now()}`,
      type,
      label: `Untitled ${type.charAt(0).toUpperCase() + type.slice(1)} Field`,
      required: false,
      options: type === "checkbox" || type === "radio" || type === "dropdown" ? ["Option 1"] : []
    };
    setQuestions([...questions, newQ]);
  };

  const deleteQuestion = (id: string) => {
    playChime();
    setQuestions(questions.filter(q => q.id !== id));
  };

  const updateQuestionLabel = (id: string, newLabel: string) => {
    setQuestions(questions.map(q => q.id === id ? { ...q, label: newLabel } : q));
  };

  const toggleQuestionRequired = (id: string) => {
    playOrganicClick();
    setQuestions(questions.map(q => q.id === id ? { ...q, required: !q.required } : q));
  };

  const addOptionToQuestion = (id: string) => {
    playOrganicClick();
    setQuestions(questions.map(q => {
      if (q.id === id) {
        return {
          ...q,
          options: [...q.options, `Option ${q.options.length + 1}`]
        };
      }
      return q;
    }));
  };

  const updateOptionText = (qId: string, optIndex: number, text: string) => {
    setQuestions(questions.map(q => {
      if (q.id === qId) {
        const newOpts = [...q.options];
        newOpts[optIndex] = text;
        return { ...q, options: newOpts };
      }
      return q;
    }));
  };

  const removeOptionFromQuestion = (qId: string, optIndex: number) => {
    playOrganicClick();
    setQuestions(questions.map(q => {
      if (q.id === qId) {
        return {
          ...q,
          options: q.options.filter((_, idx) => idx !== optIndex)
        };
      }
      return q;
    }));
  };



  return (
    <div className="min-h-screen flex flex-col relative w-full pb-20 z-10 font-sans select-none text-zinc-100">
      
      {/* Moving Ambient Glowing Orbs */}
      <div className="ambient-glow-wrapper">
        <div className="glow-orb orb-indigo"></div>
        <div className="glow-orb orb-purple"></div>
      </div>

      {/* ================= 1. NATIVE GOOGLE ACCESS PORTAL ================= */}
      {/* ================= 1. NATIVE GOOGLE ACCESS PORTAL ================= */}
      {!isLoggedIn ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/70 backdrop-blur-md">
          <div className="glass-panel w-full max-w-sm p-8 space-y-7 animate-[scale-in_0.4s_cubic-bezier(0.34,1.56,0.64,1)] relative overflow-hidden">
            
            {/* Glowing active glow circle */}
            <div className="absolute -top-16 -right-16 w-32 h-32 rounded-full bg-purple-500/20 filter blur-3xl"></div>

            <div className="text-center space-y-2">
              <h2 className="text-2xl font-black tracking-tight text-white uppercase" style={{ fontFamily: "var(--font-display)" }}>
                PORTAL ACCESS
              </h2>
              <p className="text-[9px] tracking-widest text-zinc-400 font-bold uppercase font-mono">
                AUTHENTIC GOOGLE IDENTITY ACTIVE
              </p>
            </div>

            {/* Authentic Google Button UI */}
            <div className="space-y-4">
              <div className="text-center text-xs text-zinc-400 leading-relaxed font-medium">
                Select your real Google account to log into Fluid Form Labs.
              </div>
              
              {/* Official GSI Button Target Container */}
              <div className="flex justify-center py-2 min-h-[46px]">
                <div id="official-google-btn-container" className="glow-focus"></div>
              </div>
            </div>

            <div className="text-center text-[7px] text-zinc-500 font-mono tracking-widest uppercase border-t border-white/5 pt-4">
              SECURE SSO AUTHENTICATION SYSTEM
            </div>

          </div>
        </div>
      ) : (
        // ================= 2. AUTHENTICATED SYSTEM VIEW =================
        <>
          {/* HEADER SECTION */}
          <header className="p-6 md:px-12 flex flex-col md:flex-row justify-between items-center bg-zinc-950/20 backdrop-blur-md border-b border-white/5 no-print z-20 gap-4">
            <div>
              <h1 className="text-2xl font-black tracking-tight uppercase" style={{ fontFamily: "var(--font-display)" }}>
                LAH FORMULIR
              </h1>
            </div>

            {/* Navigation options based on User Actor role */}
            <div className="flex items-center gap-3">
              {userRole === "admin" ? (
                <>
                  {!dashboardView && (
                    <button
                      onClick={navigateToDashboard}
                      className="px-4 py-2 text-xs font-bold rounded-xl bg-purple-600/10 border border-purple-500/30 hover:bg-purple-600/20 text-purple-300 transition duration-300 flex items-center gap-1"
                    >
                      🔙 DASHBOARD
                    </button>
                  )}
                  {!dashboardView && (
                    <>
                      <button
                        onClick={() => { playSoftWhoosh(); setMode("build"); setIsSubmitted(false); setSuccessGlow(false); }}
                        className={`px-4 py-2 text-xs font-bold rounded-xl border border-white/10 transition duration-300 ${mode === "build" ? "bg-purple-600/20 border-purple-500/50 text-purple-200 shadow-md shadow-purple-500/10" : "bg-white/5 text-zinc-300 hover:bg-white/10"}`}
                      >
                        📐 BUILD CANVAS
                      </button>
                      <button
                        onClick={() => { playSoftWhoosh(); setMode("fill"); }}
                        className={`px-4 py-2 text-xs font-bold rounded-xl border border-white/10 transition duration-300 ${mode === "fill" ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-200 shadow-md shadow-indigo-500/10" : "bg-white/5 text-zinc-300 hover:bg-white/10"}`}
                      >
                        ✨ RUN PREVIEW
                      </button>
                      <button
                        onClick={loadSubmissions}
                        className="px-4 py-2 text-xs font-bold rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-300 transition duration-300"
                      >
                        📊 VIEW SUBMISSIONS
                      </button>
                      <button
                        onClick={saveFormDesign}
                        className="px-5 py-2 text-xs font-bold rounded-xl bg-purple-500 text-black hover:bg-purple-400 transition shadow-lg shadow-purple-500/20 cursor-pointer"
                      >
                        💾 SAVE DESIGN
                      </button>
                      {formId && (
                        <button
                          onClick={() => copyShareLink(formId)}
                          className="px-4 py-2 text-xs font-bold rounded-xl bg-indigo-600/10 border border-indigo-500/30 hover:bg-indigo-600/20 text-indigo-300 transition duration-300 flex items-center gap-1 cursor-pointer"
                        >
                          🔗 SHARE LINK
                        </button>
                      )}
                    </>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2.5 px-4 py-2 text-xs font-bold rounded-xl bg-purple-600/15 border border-purple-500/25 text-purple-300">
                  {renderAvatar(googleUser?.picture, googleUser?.name || "G", "w-5 h-5 text-[9px]")}
                  <span>PARTICIPANT: {googleUser?.name.toUpperCase()}</span>
                </div>
              )}

              {/* Universal Google Logout */}
              <button
                onClick={handleLogout}
                className="px-3.5 py-2 text-xs font-bold rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition cursor-pointer"
                title={`Signed in as ${googleUser?.email}`}
              >
                🚪 LOG OUT
              </button>
            </div>
          </header>

          {/* DASHBOARD VIEW OR BUILDER CANVAS */}
          {dashboardView ? (
            <div className="flex-1 w-full max-w-6xl mx-auto p-6 md:p-10 space-y-10 relative z-10">
              
              {/* Dashboard Banner */}
              <div className="glass-panel p-8 md:p-12 relative overflow-hidden flex flex-col md:flex-row justify-between items-center gap-6">
                <div className="space-y-3 max-w-xl text-center md:text-left">
                  <span className="text-[9px] tracking-widest text-purple-400 font-black uppercase font-mono bg-purple-500/10 px-3 py-1 rounded-full border border-purple-500/25">
                    WORKSPACE PLATFORM
                  </span>
                  <h2 className="text-3xl font-black tracking-tight text-white uppercase" style={{ fontFamily: "var(--font-display)" }}>
                    Form Builder Suite
                  </h2>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Create high-fidelity interactive forms, invite email collaborators to build together, and export consolidated PDF respondent sheets.
                  </p>
                </div>
                
                <button
                  onClick={createNewForm}
                  className="px-6 py-4 text-xs font-black rounded-xl bg-purple-500 text-black hover:bg-purple-400 transition shadow-lg shadow-purple-500/25 cursor-pointer uppercase tracking-widest flex items-center gap-2 hover:scale-[1.02] spring-transition"
                >
                  <span>➕ CREATE NEW FORM</span>
                </button>
              </div>

              {/* History & Sections Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                
                {/* 👑 MY FORMS SECTION */}
                <div className="space-y-5">
                  <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                    <span className="text-lg">👑</span>
                    <h3 className="text-xs font-black tracking-widest text-zinc-300 uppercase font-mono">
                      My Forms ({formsList.filter(f => f.creator_email.toLowerCase() === googleUser?.email?.toLowerCase()).length})
                    </h3>
                  </div>

                  {loadingForms ? (
                    <div className="glass-panel p-16 text-center text-xs text-zinc-500 font-mono animate-pulse">
                      FETCHING CREATED FORMS...
                    </div>
                  ) : formsList.filter(f => f.creator_email.toLowerCase() === googleUser?.email?.toLowerCase()).length === 0 ? (
                    <div className="glass-panel p-12 text-center text-xs text-zinc-500 border border-dashed border-white/10 rounded-2xl">
                      NO FORMS CREATED YET.<br />
                      CLICK "CREATE NEW FORM" TO DESIGN YOUR FIRST ONE.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {formsList
                        .filter(f => f.creator_email.toLowerCase() === googleUser?.email?.toLowerCase())
                        .map(f => {
                          const fieldCount = f.fields ? (Array.isArray(f.fields) ? f.fields.length : JSON.parse(JSON.stringify(f.fields)).length || 0) : 0;
                          return (
                            <div key={f.id} className="glass-panel p-6 hover:border-purple-500/40 hover:bg-white/[0.04] transition group flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                              <div className="space-y-1.5 flex-1">
                                <h4 className="text-sm font-black text-white group-hover:text-purple-300 transition uppercase">
                                  {f.title}
                                </h4>
                                <p className="text-[10px] text-zinc-400 line-clamp-1">{f.description || "No description provided."}</p>
                                <div className="flex items-center gap-3 text-[8.5px] text-zinc-500 font-mono">
                                  <span>📝 {fieldCount} FIELDS</span>
                                  <span>&bull;</span>
                                  <span>📅 {new Date(f.created_at).toLocaleDateString("id-ID")}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                                <button
                                  onClick={() => copyShareLink(f.id)}
                                  className="px-3.5 py-2 text-[9px] font-black rounded-lg bg-indigo-500/10 border border-indigo-500/30 hover:bg-indigo-500/25 text-indigo-300 transition uppercase cursor-pointer"
                                >
                                  🔗 SHARE
                                </button>
                                <button
                                  onClick={() => navigateToForm(f.id, f.creator_email, f.collaborators, f.title, f.description, f.fields, f.stickers)}
                                  className="px-3.5 py-2 text-[9px] font-black rounded-lg bg-purple-500/10 border border-purple-500/30 hover:bg-purple-500/25 text-purple-300 transition uppercase cursor-pointer"
                                >
                                  ✏️ BUILD
                                </button>
                                <button
                                  onClick={async () => {
                                    navigateToForm(f.id, f.creator_email, f.collaborators, f.title, f.description, f.fields, f.stickers);
                                    setTimeout(loadSubmissions, 200);
                                  }}
                                  className="px-3.5 py-2 text-[9px] font-black rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-300 transition uppercase cursor-pointer"
                                >
                                  📊 FEED
                                </button>
                                <button
                                  onClick={(e) => deleteForm(f.id, e)}
                                  className="px-3.5 py-2 text-[9px] font-black rounded-lg bg-red-500/10 border border-red-500/30 hover:bg-red-500/25 text-red-300 transition uppercase cursor-pointer"
                                >
                                  🗑️ DELETE
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>

                {/* 👥 SHARED WITH ME SECTION */}
                <div className="space-y-5">
                  <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                    <span className="text-lg">👥</span>
                    <h3 className="text-xs font-black tracking-widest text-zinc-300 uppercase font-mono">
                      Shared With Me ({formsList.filter(f => f.creator_email.toLowerCase() !== googleUser?.email?.toLowerCase()).length})
                    </h3>
                  </div>

                  {loadingForms ? (
                    <div className="glass-panel p-16 text-center text-xs text-zinc-500 font-mono animate-pulse">
                      FETCHING SHARED FORMS...
                    </div>
                  ) : formsList.filter(f => f.creator_email.toLowerCase() !== googleUser?.email?.toLowerCase()).length === 0 ? (
                    <div className="glass-panel p-12 text-center text-xs text-zinc-500 border border-dashed border-white/10 rounded-2xl">
                      NO FORMS SHARED WITH YOU YET.<br />
                      INVITE OTHERS VIA EMAIL TO START COLLABORATING.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {formsList
                        .filter(f => f.creator_email.toLowerCase() !== googleUser?.email?.toLowerCase())
                        .map(f => {
                          const fieldCount = f.fields ? (Array.isArray(f.fields) ? f.fields.length : JSON.parse(JSON.stringify(f.fields)).length || 0) : 0;
                          return (
                            <div key={f.id} className="glass-panel p-6 hover:border-indigo-500/40 hover:bg-white/[0.04] transition group flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                              <div className="space-y-1.5 flex-1">
                                <h4 className="text-sm font-black text-white group-hover:text-indigo-300 transition uppercase">
                                  {f.title}
                                </h4>
                                <p className="text-[10px] text-zinc-400 line-clamp-1">{f.description || "No description."}</p>
                                <div className="flex items-center gap-3 text-[8.5px] text-zinc-500 font-mono">
                                  <span className="text-indigo-300">👑 BY {f.creator_email.toUpperCase()}</span>
                                  <span>&bull;</span>
                                  <span>📝 {fieldCount} FIELDS</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                                <button
                                  onClick={() => copyShareLink(f.id)}
                                  className="px-3.5 py-2 text-[9px] font-black rounded-lg bg-indigo-500/10 border border-indigo-500/30 hover:bg-indigo-500/25 text-indigo-300 transition uppercase cursor-pointer"
                                >
                                  🔗 SHARE
                                </button>
                                <button
                                  onClick={() => navigateToForm(f.id, f.creator_email, f.collaborators, f.title, f.description, f.fields, f.stickers)}
                                  className="px-3.5 py-2 text-[9px] font-black rounded-lg bg-indigo-500/10 border border-indigo-500/30 hover:bg-indigo-500/25 text-indigo-300 transition uppercase cursor-pointer"
                                >
                                  ✏️ EDIT
                                </button>
                                <button
                                  onClick={async () => {
                                    navigateToForm(f.id, f.creator_email, f.collaborators, f.title, f.description, f.fields, f.stickers);
                                    setTimeout(loadSubmissions, 200);
                                  }}
                                  className="px-3.5 py-2 text-[9px] font-black rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-300 transition uppercase cursor-pointer"
                                >
                                  📊 FEED
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>

              </div>

            </div>
          ) : (
            <div className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start relative z-10">
            
            {/* ================= BUILD CONTROLS (LEFT PANEL - ADMIN ONLY) ================= */}
            {mode === "build" && userRole === "admin" && (
              <aside className="lg:col-span-4 glass-panel p-6 shadow-2xl relative z-10 space-y-6 no-print">
                <h2 className="text-sm font-black tracking-widest text-zinc-300 border-b border-white/10 pb-3 uppercase" style={{ fontFamily: "var(--font-display)" }}>
                  ⚙️ Element Library
                </h2>
                
                {/* Form Info Editing */}
                <div className="space-y-4">
                  <div>
                    <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Form Name</label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full sleek-input p-3 mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Card Description</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full sleek-input p-3 mt-1 h-20 resize-none"
                    />
                  </div>
                </div>

                {/* Add Fields Panel */}
                <div className="space-y-2 pt-2">
                  <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block">Insert Input Field</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => addQuestion("text")}
                      className="p-3 text-[10px] font-bold rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 transition text-left"
                    >
                      📝 TEXT FIELD
                    </button>
                    <button
                      onClick={() => addQuestion("textarea")}
                      className="p-3 text-[10px] font-bold rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 transition text-left"
                    >
                      📖 MANIFESTO BOX
                    </button>
                    <button
                      onClick={() => addQuestion("checkbox")}
                      className="p-3 text-[10px] font-bold rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 transition text-left"
                    >
                      ☑️ CHECKBOX LIST
                    </button>
                    <button
                      onClick={() => addQuestion("radio")}
                      className="p-3 text-[10px] font-bold rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 transition text-left"
                    >
                      🔘 RADIAL OPTIONS
                    </button>
                    <button
                      onClick={() => addQuestion("dropdown")}
                      className="p-3 text-[10px] font-bold rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 transition text-left"
                    >
                      🔽 DROPDOWN SELECT
                    </button>
                  </div>
                </div>

                {/* Share / Invite Collaborator Section */}
                {formId && !formId.startsWith("local") && (
                  <div className="space-y-4 pt-4 border-t border-white/10">
                    <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block">👥 Share / Invite Collaborator</label>
                    
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="email@example.com"
                        className="flex-1 sleek-input p-2.5 text-xs bg-zinc-950/60 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const emailTrim = inviteEmail.trim().toLowerCase();
                          if (emailTrim === "") return;
                          if (collaborators.some(c => c.toLowerCase() === emailTrim)) {
                            alert("User is already a collaborator!");
                            return;
                          }
                          if (emailTrim === googleUser?.email.toLowerCase()) {
                            alert("You are already the creator!");
                            return;
                          }
                          setCollaborators([...collaborators, emailTrim]);
                          setInviteEmail("");
                          playOrganicClick();
                        }}
                        className="px-3 py-2 text-xs font-black rounded-xl bg-purple-500 text-black hover:bg-purple-400 transition"
                      >
                        ADD
                      </button>
                    </div>

                    {collaborators.length > 0 && (
                      <div className="space-y-1.5 max-h-24 overflow-y-auto pr-1">
                        {collaborators.map((email) => (
                          <div key={email} className="flex justify-between items-center bg-white/5 border border-white/5 px-3 py-1.5 rounded-lg text-[9px] font-mono">
                            <span className="text-zinc-300 line-clamp-1">{email}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setCollaborators(collaborators.filter(c => c !== email));
                                playSoftWhoosh();
                              }}
                              className="text-red-400 hover:text-red-300 font-black text-[11px] px-1"
                              title="Remove collaborator"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

              </aside>
            )}

            {/* ================= THE GLASS CANVAS (FORM PREVIEW) ================= */}
            <main className={`${(mode === "build" && userRole === "admin") ? "lg:col-span-8" : "lg:col-span-8 lg:col-start-3"} w-full flex justify-center py-4`}>
              <div className="flex flex-col w-full max-w-xl space-y-4">
                
                {/* ================= GOOGLE FORMS SYSTEM HEADER BANNER ================= */}
                {googleUser && (
                  <div className="glass-panel p-4 flex justify-between items-center text-[10px] text-zinc-300 font-mono tracking-wider border-purple-500/20 shadow-md">
                    <div className="flex items-center gap-3">
                      {renderAvatar(googleUser.picture, googleUser.name, "w-6 h-6 text-[10px]")}
                      <div className="space-y-0.5">
                        <div>
                          Signed in as <span className="text-white font-bold">{googleUser.email}</span>
                        </div>
                        <div className="text-zinc-500 text-[8px] font-sans">
                          Draft saved. Submission will be recorded under your Google account.
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="text-[9px] text-purple-400 hover:text-purple-300 font-bold border border-purple-500/30 hover:border-purple-500/60 rounded-lg px-2.5 py-1 bg-purple-500/5 transition cursor-pointer"
                    >
                      Switch Account
                    </button>
                  </div>
                )}

                <div
                  id="zine-canvas"
                  ref={canvasRef}
                  className="glass-panel w-full p-8 md:p-12 relative overflow-hidden"
                >
                  
                  {/* Dynamic success glow ring */}
                  <div className={`absolute -top-12 -right-12 w-32 h-32 rounded-full filter blur-3xl opacity-30 pointer-events-none transition duration-1000 ${successGlow ? "bg-indigo-500 success-glow-ring scale-150" : "bg-purple-500"}`}></div>

                  {/* Header info */}
                  <div className="border-b border-white/10 pb-6 mb-8">
                    <h2 className="text-2xl font-extrabold tracking-tight text-white uppercase" style={{ fontFamily: "var(--font-display)" }}>
                      {title}
                    </h2>
                    <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                      {description}
                    </p>
                  </div>

                  {/* Dynamic Inputs Form */}
                  <form onSubmit={handleFormSubmission} className="space-y-6 relative z-10">
                    {questions.length === 0 ? (
                      <div className="text-center py-16 border border-dashed border-white/10 rounded-2xl text-zinc-500 text-xs leading-relaxed">
                        GLASS CANVAS EMPTY.<br />
                        CLICK ELEMENTS IN THE LIBRARY TO START CREATING.
                      </div>
                    ) : (
                      questions.map((q) => (
                        <div key={q.id} className="group relative border-b border-white/5 pb-6 last:border-b-0 spring-transition">
                          
                          {/* Delete button (only in build mode) */}
                          {mode === "build" && userRole === "admin" && (
                            <div className="absolute top-0 right-0 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition no-print">
                              <button
                                type="button"
                                onClick={() => toggleQuestionRequired(q.id)}
                                className={`text-[8px] font-black px-2 py-0.5 border rounded-lg transition duration-200 ${q.required ? "bg-purple-500/20 border-purple-500 text-purple-200" : "bg-white/5 border-white/10 text-zinc-400"}`}
                              >
                                {q.required ? "REQUIRED" : "OPTIONAL"}
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteQuestion(q.id)}
                                className="bg-white/10 border border-white/20 hover:bg-red-500/20 hover:border-red-500/50 text-white rounded-lg px-1.5 py-0.5 font-bold text-[9px] transition"
                                title="Tear off question"
                              >
                                DELETE
                              </button>
                            </div>
                          )}

                          {/* Question Title */}
                          {mode === "build" && userRole === "admin" ? (
                            <input
                              type="text"
                              value={q.label}
                              onChange={(e) => updateQuestionLabel(q.id, e.target.value)}
                              className="w-full text-xs font-black uppercase text-zinc-200 bg-transparent border-b border-dashed border-white/10 py-1 focus:outline-none focus:border-purple-500 font-semibold"
                              placeholder="Edit Field Label..."
                            />
                          ) : (
                            <label className="block text-xs font-bold uppercase tracking-widest text-zinc-300 mb-2">
                              {q.label} {q.required && <span className="text-red-500">*</span>}
                            </label>
                          )}

                          {/* Inputs */}
                          <div className="mt-3">
                            
                            {/* 1. TEXT FIELD (Locked for Guest Tag input!) */}
                            {q.type === "text" && (
                              <input
                                type="text"
                                required={q.required && mode === "fill"}
                                disabled={mode === "build" || (q.id === "q-alias" && userRole === "guest")}
                                value={q.id === "q-alias" && googleUser ? googleUser.name.toUpperCase() : answers[q.id] || ""}
                                onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                                className={`w-full sleek-input p-3 ${q.id === "q-alias" && userRole === "guest" ? "border-purple-500/30 text-purple-300 bg-purple-500/5 font-bold cursor-not-allowed" : ""}`}
                                placeholder={mode === "build" ? "TEXT BOX PREVIEW" : "Type your answer..."}
                              />
                            )}

                            {/* 2. TEXTAREA */}
                            {q.type === "textarea" && (
                              <textarea
                                required={q.required && mode === "fill"}
                                disabled={mode === "build"}
                                onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                                className="w-full sleek-input p-3 h-24 resize-none focus:outline-none"
                                placeholder={mode === "build" ? "TEXTAREA PREVIEW" : "Type your detailed answer..."}
                              />
                            )}

                            {/* 3. CHECKBOXES */}
                            {q.type === "checkbox" && (
                              <div className="flex flex-wrap gap-2 pt-1">
                                {q.options.map((opt, optIdx) => {
                                  const isSel = (answers[q.id] || []).includes(opt);
                                  return (
                                    <div key={optIdx} className="flex items-center">
                                      {mode === "build" && userRole === "admin" ? (
                                        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 flex-1">
                                          <input
                                            type="text"
                                            value={opt}
                                            onChange={(e) => updateOptionText(q.id, optIdx, e.target.value)}
                                            className="text-xs bg-transparent focus:outline-none text-zinc-300 flex-1"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => removeOptionFromQuestion(q.id, optIdx)}
                                            className="text-xs text-red-400 hover:text-red-300 px-0.5 font-bold"
                                          >
                                            ×
                                          </button>
                                        </div>
                                      ) : (
                                        <div
                                          onClick={() => {
                                            const current = answers[q.id] || [];
                                            if (current.includes(opt)) {
                                              setAnswers({ ...answers, [q.id]: current.filter((x: string) => x !== opt) });
                                            } else {
                                              setAnswers({ ...answers, [q.id]: [...current, opt] });
                                            }
                                          }}
                                          className={`pill-choice text-xs ${isSel ? "selected" : ""}`}
                                        >
                                          {opt}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                                {mode === "build" && userRole === "admin" && (
                                  <button
                                    type="button"
                                    onClick={() => addOptionToQuestion(q.id)}
                                    className="text-[9px] font-black text-zinc-500 hover:text-zinc-300 px-3 py-2 border border-dashed border-white/10 rounded-xl transition font-mono uppercase"
                                  >
                                    ➕ Add Choice
                                  </button>
                                )}
                              </div>
                            )}

                            {/* 4. RADIO PILLS */}
                            {q.type === "radio" && (
                              <div className="flex flex-wrap gap-2 pt-1">
                                {q.options.map((opt, optIdx) => {
                                  const isSel = answers[q.id] === opt;
                                  return (
                                    <div key={optIdx} className="flex items-center">
                                      {mode === "build" && userRole === "admin" ? (
                                        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 flex-1">
                                          <input
                                            type="text"
                                            value={opt}
                                            onChange={(e) => updateOptionText(q.id, optIdx, e.target.value)}
                                            className="text-xs bg-transparent focus:outline-none text-zinc-300 flex-1"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => removeOptionFromQuestion(q.id, optIdx)}
                                            className="text-xs text-red-400 hover:text-red-300 px-0.5 font-bold"
                                          >
                                            ×
                                          </button>
                                        </div>
                                      ) : (
                                        <div
                                          onClick={() => setAnswers({ ...answers, [q.id]: opt })}
                                          className={`pill-choice text-xs ${isSel ? "selected" : ""}`}
                                        >
                                          {opt}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                                {mode === "build" && userRole === "admin" && (
                                  <button
                                    type="button"
                                    onClick={() => addOptionToQuestion(q.id)}
                                    className="text-[9px] font-black text-zinc-500 hover:text-zinc-300 px-3 py-2 border border-dashed border-white/10 rounded-xl transition font-mono uppercase"
                                  >
                                    ➕ Add Choice
                                  </button>
                                )}
                              </div>
                            )}

                            {/* 5. DROPDOWN */}
                            {q.type === "dropdown" && (
                              <div className="space-y-2">
                                {mode === "build" && userRole === "admin" ? (
                                  <div className="space-y-2 bg-white/5 p-3 border border-white/10 rounded-2xl">
                                    {q.options.map((opt, optIdx) => (
                                      <div key={optIdx} className="flex items-center gap-2">
                                        <span className="text-[9px] font-mono text-zinc-500">{optIdx+1}.</span>
                                        <input
                                          type="text"
                                          value={opt}
                                          onChange={(e) => updateOptionText(q.id, optIdx, e.target.value)}
                                          className="text-xs bg-transparent border-b border-white/10 py-0.5 focus:outline-none focus:border-purple-500 flex-1 text-zinc-300"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => removeOptionFromQuestion(q.id, optIdx)}
                                          className="text-xs text-red-400 hover:text-red-300 px-1 font-bold"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    ))}
                                    <button
                                      type="button"
                                      onClick={() => addOptionToQuestion(q.id)}
                                      className="text-[9px] font-black text-zinc-500 hover:text-zinc-300 mt-2 font-mono uppercase block"
                                    >
                                      ➕ Add Dropdown Option
                                    </button>
                                  </div>
                                ) : (
                                  <select
                                    required={q.required}
                                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                                    className="w-full sleek-input p-3 bg-zinc-950/60 cursor-pointer"
                                  >
                                    <option value="">-- Select Choice --</option>
                                    {q.options.map((opt, optIdx) => (
                                      <option key={optIdx} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            )}

                          </div>
                        </div>
                      ))
                    )}

                    {/* Submit button (only in Fill mode) */}
                    {mode === "fill" && questions.length > 0 && (
                      <div className="pt-6 border-t border-white/10 flex justify-center">
                        <button
                          type="submit"
                          disabled={submitting || isSubmitted}
                          className="w-full py-4 text-xs font-black rounded-xl bg-gradient-to-r from-purple-500 to-indigo-500 text-black hover:from-purple-400 hover:to-indigo-400 active:scale-98 transition duration-300 text-center uppercase tracking-widest shadow-xl shadow-purple-500/10 cursor-pointer"
                        >
                          {submitting ? "SUBMITTING..." : "✨ SECURE SUBMISSION"}
                        </button>
                      </div>
                    )}
                  </form>



                </div>
              </div>
            </main>
          </div>
          )}

          {/* ================= 3D FROSTED GLASS RECEIPT SUMMARY ================= */}
          {isSubmitted && (
            <div id="receipt-overlay-container" className="fixed inset-0 bg-black/85 backdrop-blur-md flex justify-center items-center p-4 z-50 overflow-y-auto">
              <div className="glass-receipt w-full max-w-sm p-6 md:p-8 space-y-6 animate-[scale-in_0.4s_cubic-bezier(0.34,1.56,0.64,1)] my-8">
                <div className="glass-receipt-inner space-y-6">
                  
                  {/* Header */}
                  <div className="text-center border-b border-white/10 pb-4">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400 mb-3 success-glow-ring">
                      ✓
                    </div>
                    <h3 className="text-md font-extrabold tracking-widest text-white uppercase" style={{ fontFamily: "var(--font-display)" }}>
                      SUBMISSION SECURED
                    </h3>
                    <p className="text-[8px] tracking-widest text-zinc-500 uppercase mt-1">
                      FLUID CORE LOGISTICS SYSTEM
                    </p>
                    <div className="text-[8px] text-zinc-500 mt-2 font-mono">
                      REF ID: #FL-{timeStringID()}<br />
                      TIME: {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}
                    </div>
                  </div>

                  {/* Items Breakdown */}
                  <div className="space-y-4 text-xs">
                    <div className="flex justify-between font-bold border-b border-white/5 pb-1 text-[9px] text-zinc-500 uppercase tracking-widest">
                      <span>ELEMENT</span>
                      <span>RECORDED VALUE</span>
                    </div>
                    
                    {questions.map((q) => {
                      const ansVal = q.id === "q-alias" && googleUser ? googleUser.name : answers[q.id];
                      return (
                        <div key={q.id} className="border-b border-white/5 pb-3">
                          <div className="font-bold text-[9px] text-zinc-400 uppercase tracking-widest">
                            {q.label}
                          </div>
                          <div className="text-white mt-1.5 text-xs bg-white/5 border border-white/5 p-2 rounded-xl italic">
                            {Array.isArray(ansVal) 
                              ? ansVal.join(", ") 
                              : (ansVal || "N/A")}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Total & Meta */}
                  <div className="border-t border-white/10 pt-4 space-y-2 text-[9px] text-zinc-500">
                    <div className="flex justify-between font-bold text-white text-xs">
                      <span>SECURED CHANNELS</span>
                      <span>{Object.keys(answers).length || 1} / {questions.length}</span>
                    </div>
                    <div className="text-center pt-2 italic text-zinc-500">
                      * RECORD PERSISTED TO NEON POSTGRES CLOUD *
                    </div>
                  </div>

                  {/* Barcode */}
                  <div className="flex flex-col items-center pt-2 border-t border-white/10">
                    <svg className="w-48 h-8 opacity-75" viewBox="0 0 100 30" xmlns="http://www.w3.org/2000/svg">
                      <rect width="100" height="30" fill="transparent"/>
                      <rect x="2" y="0" width="1" height="30" fill="#fff" />
                      <rect x="5" y="0" width="3" height="30" fill="#fff" />
                      <rect x="10" y="0" width="1" height="30" fill="#fff" />
                      <rect x="14" y="0" width="2" height="30" fill="#fff" />
                      <rect x="18" y="0" width="4" height="30" fill="#fff" />
                      <rect x="24" y="0" width="1" height="30" fill="#fff" />
                      <rect x="28" y="0" width="5" height="30" fill="#fff" />
                      <rect x="36" y="0" width="2" height="30" fill="#fff" />
                      <rect x="42" y="0" width="1" height="30" fill="#fff" />
                      <rect x="46" y="0" width="3" height="30" fill="#fff" />
                      <rect x="52" y="0" width="4" height="30" fill="#fff" />
                      <rect x="58" y="0" width="1" height="30" fill="#fff" />
                      <rect x="62" y="0" width="2" height="30" fill="#fff" />
                      <rect x="66" y="0" width="6" height="30" fill="#fff" />
                      <rect x="74" y="0" width="1" height="30" fill="#fff" />
                      <rect x="78" y="0" width="3" height="30" fill="#fff" />
                      <rect x="84" y="0" width="2" height="30" fill="#fff" />
                      <rect x="88" y="0" width="4" height="30" fill="#fff" />
                      <rect x="94" y="0" width="1" height="30" fill="#fff" />
                      <rect x="97" y="0" width="2" height="30" fill="#fff" />
                    </svg>
                    <span className="text-[6px] tracking-widest text-zinc-500 font-bold uppercase mt-1">
                      * {formId ? formId.substring(0,18).toUpperCase() : "SECURE-TRANSACT"} *
                    </span>
                  </div>

                  {/* Controls */}
                  <div className="print-btn-group flex gap-2 pt-2">
                    <button
                      onClick={() => { playOrganicClick(); window.print(); }}
                      className="flex-1 py-3 text-xs font-bold rounded-xl bg-white text-black hover:bg-zinc-200 transition text-center cursor-pointer"
                    >
                      📄 EXPORT PDF / PRINT
                    </button>
                    <button
                      onClick={() => { playSoftWhoosh(); setIsSubmitted(false); setSuccessGlow(false); }}
                      className="py-3 px-5 text-xs font-bold rounded-xl bg-white/5 hover:bg-white/10 transition text-center cursor-pointer"
                    >
                      CLOSE
                    </button>
                  </div>

                </div>
              </div>
            </div>
          )}

          {/* ================= ADMIN ONLY SUBMISSIONS LIST DASHBOARD OVERLAY ================= */}
          {viewingResponses && userRole === "admin" && (
            <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex justify-center items-center p-4 z-50 overflow-y-auto">
              <div className="glass-panel w-full max-w-2xl p-6 md:p-8 space-y-6 animate-[scale-in_0.4s_cubic-bezier(0.34,1.56,0.64,1)] my-8">
                
                <div className="flex justify-between items-center border-b border-white/10 pb-4">
                  <div>
                    <h3 className="text-lg font-black tracking-tight text-white uppercase" style={{ fontFamily: "var(--font-display)" }}>
                      📊 RESPONDENT RECORDS FEED
                    </h3>
                    <p className="text-[9px] tracking-widest text-purple-400 font-bold font-mono mt-0.5">
                      LIVE CLOUD DATA INGESTION
                    </p>
                  </div>
                  <button
                    onClick={() => { playSoftWhoosh(); setViewingResponses(false); }}
                    className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white font-bold flex items-center justify-center border border-white/10 transition text-lg cursor-pointer"
                  >
                    ×
                  </button>
                </div>

                {loadingResponses ? (
                  <div className="text-center py-20 font-mono text-xs text-zinc-500">
                    GETTING RESPONSES FROM NEON CLOUD ENGINE...
                  </div>
                ) : responsesList.length === 0 ? (
                  <div className="text-center py-20 border border-dashed border-white/10 rounded-2xl text-zinc-500 text-xs">
                    NO RESPONDENT DATA STORED YET.<br />
                    LOG IN AS GUEST AND SUBMIT A RESPONSE TO POPULATE THIS FEED.
                  </div>
                ) : (
                  <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                    {responsesList.map((resp) => {
                      const aliasVal = resp.answers["q-alias"] || "ANONYMOUS GUEST";
                      const userMeta = resp.answers["google_user"] as GoogleUser || null;
                      
                      return (
                        <div key={resp.id} className="p-4 bg-white/5 border border-white/5 hover:bg-white/10 rounded-xl space-y-3 transition">
                          <div className="flex justify-between items-center border-b border-white/5 pb-2">
                            <div className="flex items-center gap-2.5">
                              {renderAvatar(userMeta?.picture || aliasVal.charAt(0).toUpperCase(), aliasVal, "w-6 h-6 text-[10px]")}
                              <div className="flex flex-col">
                                <span className="text-xs font-black text-purple-300 uppercase tracking-widest">
                                  {aliasVal}
                                </span>
                                {userMeta && (
                                  <span className="text-[7.5px] text-zinc-500 font-mono">
                                    {userMeta.email}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2.5">
                              <span className="text-[8px] font-mono text-zinc-500">
                                REF: #{resp.id.substring(0,8).toUpperCase()} // {new Date(resp.created_at).toLocaleString("id-ID")}
                              </span>
                              <button
                                onClick={() => printSingleResponse(resp, aliasVal, userMeta)}
                                className="text-[8px] font-black px-2.5 py-1 bg-purple-500/10 border border-purple-500/30 hover:bg-purple-500/20 text-purple-400 rounded-lg transition duration-200 cursor-pointer"
                              >
                                📄 EXPORT PDF
                              </button>
                            </div>
                          </div>
                          
                          {/* Key values */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                            {Object.entries(resp.answers)
                              .filter(([key]) => key !== "google_user")
                              .map(([key, val]) => {
                                const matchingQ = questions.find(q => q.id === key);
                                const labelText = matchingQ ? matchingQ.label : key;
                                return (
                                  <div key={key} className="text-[10px] space-y-1">
                                    <div className="text-zinc-500 font-bold uppercase tracking-wider">{labelText}:</div>
                                    <div className="text-zinc-200 font-serif italic bg-zinc-950/40 p-1.5 rounded-lg border border-white/5">
                                      {Array.isArray(val) ? val.join(", ") : val}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex justify-end gap-2.5 pt-2 border-t border-white/10">
                  <button
                    onClick={printAllResponses}
                    className="py-3 px-6 text-xs font-black rounded-xl bg-purple-500 text-black hover:bg-purple-400 transition cursor-pointer shadow-lg shadow-purple-500/10"
                  >
                    📄 EXPORT ALL TO PDF
                  </button>
                  <button
                    onClick={() => { playSoftWhoosh(); setViewingResponses(false); }}
                    className="py-3 px-6 text-xs font-bold rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-300 transition cursor-pointer"
                  >
                    CLOSE FEED
                  </button>
                </div>

              </div>
            </div>
          )}

          {/* FOOTER */}
          <footer className="absolute bottom-0 left-0 right-0 py-4 text-center text-[7px] tracking-widest text-zinc-600 border-t border-white/5 bg-zinc-950/20 backdrop-blur-md no-print uppercase">
            FLUID BUILDER LABS © 2026 // ALL SYSTEM GLOWS ACTIVE // NEXT.JS + GOLANG + POSTGRESQL (NEON.TECH)
          </footer>
        </>
      )}

    </div>
  );
}
