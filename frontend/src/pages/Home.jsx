import { useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  Upload,
  Sparkles,
  Download,
  Trash2,
  X,
  Wand2,
  Camera,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";

const BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
const sessionId = localStorage.getItem("face-erase-session") || crypto.randomUUID();
localStorage.setItem("face-erase-session", sessionId);
const API = `${BACKEND_URL}/api`;

const LOADING_PHRASES = [
  "Staging the scene...",
  "Adjusting the lights...",
  "Directing the talent...",
  "Color grading the frame...",
  "Final cut, almost there...",
];

const SUGGESTIONS = [
  "Replace the woman with the woman from the second photo, keep everyone else and the background identical, photorealistic.",
  "Put the person from photo 2 standing next to the person in photo 1 at the same location, natural lighting.",
  "Combine both subjects into one cinematic candid photo at golden hour.",
];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); // data:image/...;base64,...
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function Dropzone({ label, hint, value, onChange, testid }) {
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      window.alert("Choose a JPEG, PNG, or WebP photo.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      window.alert("Each photo must be under 10 MB.");
      return;
    }
    const dataUrl = await fileToBase64(file);
    onChange(dataUrl);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="chip" data-testid={`${testid}-label`}>
          <Camera size={12} /> {label}
        </span>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-white/50 hover:text-white inline-flex items-center gap-1"
            data-testid={`${testid}-clear`}
          >
            <X size={12} /> clear
          </button>
        )}
      </div>
      <div
        className={`dropzone ${value ? "has-image" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          handleFile(file);
        }}
        data-testid={testid}
      >
        {value ? (
          <img src={value} alt={label} className="preview" />
        ) : (
          <div className="flex flex-col items-center gap-3 text-white/60 px-6 text-center">
            <Upload size={26} className="gold" />
            <div className="font-display text-2xl text-white/90">{hint}</div>
            <div className="text-xs uppercase tracking-widest">
              Drop or click to upload
            </div>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
          data-testid={`${testid}-input`}
        />
      </div>
    </div>
  );
}

export default function Home() {
  const [img1, setImg1] = useState(null); // base photo (your photo)
  const [img2, setImg2] = useState(null); // replacement photo
  const [prompt, setPrompt] = useState(
    "Replace the selected person in the first photo with the person from the second photo. Preserve the background and everyone else, matching the original lighting and perspective."
  );
  const [loading, setLoading] = useState(false);
  const [loadingPhrase, setLoadingPhrase] = useState(LOADING_PHRASES[0]);
  const [result, setResult] = useState(null); // {data, mime_type, prompt, id, created_at}
  const [error, setError] = useState("");
  const [creations, setCreations] = useState([]);

  const loadCreations = async () => {
    try {
      const res = await axios.get(`${API}/creations?session_id=${sessionId}`);
      setCreations(res.data || []);
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    loadCreations();
  }, []);

  useEffect(() => {
    if (!loading) return;
    let i = 0;
    const t = setInterval(() => {
      i = (i + 1) % LOADING_PHRASES.length;
      setLoadingPhrase(LOADING_PHRASES[i]);
    }, 1800);
    return () => clearInterval(t);
  }, [loading]);

  const onGenerate = async () => {
    setError("");
    if (!img1 || !img2) {
      setError("Please upload both photos.");
      return;
    }
    if (!prompt.trim()) {
      setError("Please describe the scene.");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await axios.post(
        `${API}/generate-photo`,
        {
          image1_base64: img1,
          image2_base64: img2,
          prompt,
          session_id: sessionId,
        },
        { timeout: 180000 }
      );
      setResult(res.data);
      loadCreations();
    } catch (e) {
      const msg =
        e?.response?.data?.detail || e.message || "Generation failed.";
      setError(typeof msg === "string" ? msg : "Generation failed.");
    } finally {
      setLoading(false);
    }
  };

  const onDownload = (b64, mime, idx = 0) => {
    const a = document.createElement("a");
    a.href = `data:${mime || "image/png"};base64,${b64}`;
    a.download = `star-scene-${idx}-${Date.now()}.png`;
    a.click();
  };

  const onDelete = async (id) => {
    try {
      await axios.delete(`${API}/creations/${id}?session_id=${sessionId}`);
      loadCreations();
    } catch (e) { setError("Could not remove that photo. Please try again."); }
  };

  return (
    <div className="bg-cinematic grain min-h-screen relative">
      {/* Header */}
      <header className="relative z-10 px-6 md:px-12 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="gold" />
          <span className="font-display text-2xl tracking-tight">
            Face Erase & Replace
          </span>
        </div>
        <div className="hidden md:flex items-center gap-3 text-white/60 text-sm">
          <span className="chip">
            <Wand2 size={12} /> Photo editing studio
          </span>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 px-6 md:px-12 pt-6 pb-10 max-w-6xl">
        <div className="flex flex-col gap-4">
          <span className="chip w-fit" data-testid="hero-eyebrow">
            <Sparkles size={12} /> Photo · AI · Cinema
          </span>
          <h1
            className="font-display text-5xl md:text-7xl leading-[1.02] text-white"
            data-testid="hero-title"
          >
            Star in your own <span className="gold italic">scene.</span>
          </h1>
          <p className="text-white/60 max-w-xl text-lg">
            Drop in two photos. Direct the moment. We'll quietly fold them into
            a single photorealistic frame — your face, their face, one story.
          </p>
        </div>
      </section>

      {/* Studio */}
      <section className="relative z-10 px-6 md:px-12 pb-16 max-w-6xl">
        <div className="glass p-6 md:p-10">
          {/* Bento upload grid */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch">
            <div className="md:col-span-5">
              <Dropzone
                label="Photo One · The Base"
                hint="Your photo"
                value={img1}
                onChange={setImg1}
                testid="user-photo-upload"
              />
            </div>

            <div className="md:col-span-2 flex flex-col items-center justify-center gap-3">
              <div className="hidden md:block w-px h-32 bg-white/10" />
              <div
                className="font-display italic text-3xl gold"
                data-testid="plus-divider"
              >
                with
              </div>
              <div className="hidden md:block w-px h-32 bg-white/10" />
            </div>

            <div className="md:col-span-5">
              <Dropzone
                label="Photo Two · The Replacement"
                hint="Replacement photo"
                value={img2}
                onChange={setImg2}
                testid="celebrity-photo-upload"
              />
            </div>
          </div>

          <div className="divider-soft my-8" />

          {/* Prompt + CTA */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            <div className="md:col-span-8">
              <label className="text-xs uppercase tracking-widest text-white/50 mb-2 block">
                Direct the scene
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                className="input-dark"
                maxLength={4000}
                placeholder="Describe the scene you want…"
                data-testid="scene-prompt-input"
              />
              <div className="flex flex-wrap gap-2 mt-3">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPrompt(s)}
                    className="btn-ghost text-xs"
                    data-testid={`suggestion-${i}`}
                  >
                    {s.length > 60 ? s.slice(0, 60) + "…" : s}
                  </button>
                ))}
              </div>
            </div>
            <div className="md:col-span-4 flex flex-col justify-end gap-3">
              <button
                onClick={onGenerate}
                disabled={loading}
                className="btn-gold w-full flex items-center justify-center gap-2"
                data-testid="generate-photo-button"
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Generating
                  </>
                ) : (
                  <>
                    <Wand2 size={16} />
                    Make the photo
                  </>
                )}
              </button>
              <p className="text-xs text-white/40 text-center">
                One image, one moment. Editing may take a few minutes.
              </p>
            </div>
          </div>

          {error && (
            <div
              className="mt-6 text-sm rounded-xl px-4 py-3 border border-red-500/40 bg-red-500/10 text-red-200"
              data-testid="error-message"
            >
              {error}
            </div>
          )}

          {/* Result panel */}
          <div className="mt-10">
            {loading && (
              <div
                className="rounded-2xl overflow-hidden border border-white/10"
                data-testid="result-loading"
              >
                <div className="aspect-video shimmer flex items-center justify-center">
                  <div className="flex flex-col items-center gap-3 text-white/80">
                    <Loader2 className="animate-spin gold" size={28} />
                    <div className="font-display text-2xl italic">
                      {loadingPhrase}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {result && !loading && (
              <div
                className="rounded-2xl overflow-hidden border border-white/10 fade-up"
                data-testid="result-container"
              >
                <img
                  src={`data:${result.mime_type};base64,${result.result_image_base64}`}
                  alt="Result"
                  className="w-full"
                  data-testid="result-image"
                />
                <div className="flex items-center justify-between p-4 bg-black/40">
                  <div className="text-xs text-white/50 line-clamp-1 pr-4">
                    {result.prompt}
                  </div>
                  <button
                    onClick={() =>
                      onDownload(
                        result.result_image_base64,
                        result.mime_type,
                        result.id?.slice(0, 4)
                      )
                    }
                    className="btn-ghost text-sm inline-flex items-center gap-2"
                    data-testid="download-result-button"
                  >
                    <Download size={14} /> Download
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Gallery */}
      {creations.length > 0 && (
        <section
          className="relative z-10 px-6 md:px-12 pb-24 max-w-6xl"
          data-testid="history-gallery-grid"
        >
          <div className="flex items-end justify-between mb-6">
            <h2 className="font-display text-3xl md:text-4xl">
              Your <span className="italic gold">archive</span>
            </h2>
            <span className="text-xs uppercase tracking-widest text-white/50">
              {creations.length} {creations.length === 1 ? "scene" : "scenes"}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {creations.map((c, i) => (
              <div
                key={c.id}
                className="glass overflow-hidden group"
                data-testid={`gallery-item-${i}`}
                style={{
                  gridRow: i % 5 === 0 ? "span 2" : "span 1",
                }}
              >
                <div className="relative">
                  <img
                    src={`data:${c.mime_type};base64,${c.result_image_base64}`}
                    alt={c.prompt}
                    className="w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-black/0 opacity-100 transition-opacity flex items-end p-3 gap-2">
                    <button
                      onClick={() =>
                        onDownload(c.result_image_base64, c.mime_type, i)
                      }
                      className="btn-ghost text-xs inline-flex items-center gap-1"
                      data-testid={`gallery-download-${i}`}
                    >
                      <Download size={12} /> Save
                    </button>
                    <button
                      onClick={() => onDelete(c.id)}
                      className="btn-ghost text-xs inline-flex items-center gap-1"
                      data-testid={`gallery-delete-${i}`}
                    >
                      <Trash2 size={12} /> Remove
                    </button>
                  </div>
                </div>
                <div className="p-3 text-xs text-white/50 line-clamp-2">
                  {c.prompt}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="relative z-10 px-6 md:px-12 py-8 text-center text-white/30 text-xs uppercase tracking-[0.3em]">
        <span className="inline-flex items-center gap-2">
          <ImageIcon size={12} /> Made with Face Erase & Replace
        </span>
      </footer>
    </div>
  );
}
