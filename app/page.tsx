import Link from "next/link";
import Splash from "@/components/Splash";
import "./landing.css";

const Ico = ({ d, size = 24 }: { d: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

const D = {
  logo: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 15h6 M9 11h2",
  camera:
    "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  sparkles: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z",
  sliders: "M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6",
  crop: "M6 2v14a2 2 0 0 0 2 2h14 M18 22V8a2 2 0 0 0-2-2H2",
  layers: "M12 2l10 5-10 5L2 7z M2 17l10 5 10-5 M2 12l10 5 10-5",
  pen: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  files: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M12 18v-6 M9 15h6",
  lock: "M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4",
  phone: "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M12 18h.01",
  check: "M20 6L9 17l-5-5",
  arrow: "M5 12h14 M13 6l6 6-6 6",
};

const FEATURES = [
  { icon: D.camera, title: "Multi-shot camera", text: "Keep the camera open and snap page after page. Finish when you're done, with a live counter for the 30-page limit." },
  { icon: D.sparkles, title: "Smart auto-crop", text: "Finds the edges of your page and straightens the perspective automatically, so a tilted photo becomes a flat scan." },
  { icon: D.sliders, title: "Scan filters", text: "Magic color, Gray and B&W clean up shadows and paper tone. Fine-tune with brightness and contrast, or apply one look to every page." },
  { icon: D.crop, title: "Manual crop", text: "Drag four corners to fit the page exactly. Auto detect didn't nail it? Adjust it in seconds." },
  { icon: D.layers, title: "Organize pages", text: "Reorder, rotate, delete or duplicate pages. Pick A4, Letter or fit-to-image and name your file." },
  { icon: D.pen, title: "Edit any PDF", text: "Open a PDF from your phone or laptop. Add text, draw or sign, highlight, and cover areas, then save a new copy." },
  { icon: D.files, title: "Merge and combine", text: "Add more PDFs, photos or blank pages to the same document and arrange everything in one place." },
  { icon: D.lock, title: "Private by design", text: "Your files are processed in your browser. Nothing is uploaded to a server, and there's no account to create." },
];

const STEPS = [
  { n: "1", title: "Capture or upload", text: "Take photos with the built-in camera or pick images from your gallery or computer." },
  { n: "2", title: "Clean up", text: "Pages are auto-cropped and filtered. Adjust corners, filters and order if you like." },
  { n: "3", title: "Save, share or edit", text: "Create your PDF, share it from your phone, or open it in the editor to add text, drawings and more." },
];

const FAQ = [
  { q: "Are my files uploaded anywhere?", a: "No. Scanning, filters, and PDF editing all run inside your browser on your device. Your documents are never sent to a server." },
  { q: "Do I need to create an account?", a: "No. Open the app and start scanning or editing." },
  { q: "How many pages can I scan at once?", a: "Up to 30 images per scan, up to 25 MB each. The PDF editor can open larger documents, but very big files may be slow on older phones." },
  { q: "Can I change the existing text inside a PDF?", a: "Not yet. You can add new text, draw, highlight, cover areas and rearrange pages, but the original text of a PDF can't be rewritten." },
  { q: "Is the Cover tool safe for hiding private information?", a: "No. It places a solid box over the page, but the content underneath is still in the file. Don't rely on it to hide sensitive data." },
  { q: "Which languages can I type in the editor?", a: "Added text supports English and most European languages. Other scripts aren't supported yet." },
  { q: "What do I need for auto-crop?", a: "The first time you use auto-crop, the app downloads a small computer-vision library, so you need an internet connection. If it can't load, you can still crop by hand." },
  { q: "Does it work on iPhone, Android and desktop?", a: "Yes, in any modern browser. The live camera needs a secure (https) page, and you can add the app to your home screen for quick access." },
];

export default function Landing() {
  return (
    <div className="lp">
      <Splash />

      {/* Nav */}
      <header className="lp-nav">
        <div className="lp-container lp-nav-in">
          <Link href="/" className="lp-brand">
            <span className="lp-logo">
              <Ico d={D.logo} size={20} />
            </span>
            Image to PDF
          </Link>
          <nav className="lp-links" aria-label="Sections">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#faq">FAQ</a>
          </nav>
          <Link href="/scan/" className="lp-btn sm">
            Open app
          </Link>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="lp-hero">
          <div className="lp-container lp-hero-grid">
            <div className="lp-hero-copy">
              <span className="lp-pill">
                <i /> Private · No sign-up · Runs in your browser
              </span>
              <h1>
                Scan, clean up and <span className="lp-grad">edit PDFs</span> from any device
              </h1>
              <p>
                Turn camera photos into crisp, auto-cropped PDFs, then add text, drawings and
                highlights, or rearrange pages. Everything happens on your phone or laptop.
              </p>
              <div className="lp-cta-row">
                <Link href="/scan/" className="lp-btn">
                  <Ico d={D.camera} size={20} /> Scan documents
                </Link>
                <Link href="/editor/" className="lp-btn ghost">
                  <Ico d={D.pen} size={20} /> Edit a PDF
                </Link>
              </div>
              <ul className="lp-ticks">
                <li><Ico d={D.check} size={16} /> Multi-shot camera</li>
                <li><Ico d={D.check} size={16} /> Auto-crop &amp; filters</li>
                <li><Ico d={D.check} size={16} /> Works on iPhone &amp; Android</li>
              </ul>
            </div>

            {/* Phone mockup */}
            <div className="lp-visual" aria-hidden="true">
              <div className="lp-glow" />
              <div className="lp-phone">
                <div className="lp-notch" />
                <div className="lp-screen">
                  <div className="lp-doc">
                    <b />
                    <i style={{ width: "86%" }} />
                    <i style={{ width: "94%" }} />
                    <i style={{ width: "72%" }} />
                    <em />
                    <i style={{ width: "90%" }} />
                    <i style={{ width: "64%" }} />
                    <i style={{ width: "80%" }} />
                    <span className="lp-c tl" />
                    <span className="lp-c tr" />
                    <span className="lp-c bl" />
                    <span className="lp-c br" />
                    <span className="lp-scanline" />
                  </div>
                  <div className="lp-chip"><Ico d={D.check} size={14} /> Page detected</div>
                  <div className="lp-shutter"><span /></div>
                </div>
              </div>
              <div className="lp-float f1"><Ico d={D.sparkles} size={16} /> Magic color</div>
              <div className="lp-float f2"><Ico d={D.pen} size={16} /> Sign &amp; annotate</div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="lp-section">
          <div className="lp-container">
            <div className="lp-head">
              <span className="lp-eyebrow">Features</span>
              <h2>Everything you need to go from paper to polished PDF</h2>
              <p>A scanner and a PDF editor in one lightweight web app.</p>
            </div>
            <div className="lp-grid">
              {FEATURES.map((f) => (
                <article key={f.title} className="lp-card">
                  <span className="lp-ico">
                    <Ico d={f.icon} />
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="lp-section alt">
          <div className="lp-container">
            <div className="lp-head">
              <span className="lp-eyebrow">How it works</span>
              <h2>Three steps. No learning curve.</h2>
            </div>
            <ol className="lp-steps">
              {STEPS.map((s) => (
                <li key={s.n}>
                  <span className="lp-num">{s.n}</span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Two tools */}
        <section className="lp-section">
          <div className="lp-container lp-duo">
            <Link href="/scan/" className="lp-tool a">
              <span className="lp-ico light"><Ico d={D.camera} /></span>
              <h3>Scanner</h3>
              <p>Camera or gallery to a clean, multi-page PDF in under a minute.</p>
              <span className="lp-go">Start scanning <Ico d={D.arrow} size={18} /></span>
            </Link>
            <Link href="/editor/" className="lp-tool b">
              <span className="lp-ico light"><Ico d={D.pen} /></span>
              <h3>PDF editor</h3>
              <p>Add text, sign, highlight and reorder pages in any PDF you open.</p>
              <span className="lp-go">Open the editor <Ico d={D.arrow} size={18} /></span>
            </Link>
          </div>
        </section>

        {/* Privacy */}
        <section className="lp-section alt">
          <div className="lp-container">
            <div className="lp-privacy">
              <span className="lp-ico light"><Ico d={D.lock} /></span>
              <div>
                <h2>Your documents stay yours</h2>
                <p>
                  Images and PDFs are processed locally in your browser. There are no uploads, no
                  accounts and no tracking of your files. Close the tab and they&apos;re gone.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="lp-section">
          <div className="lp-container narrow">
            <div className="lp-head">
              <span className="lp-eyebrow">FAQ</span>
              <h2>Good to know</h2>
            </div>
            <div className="lp-faq">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="lp-section">
          <div className="lp-container">
            <div className="lp-final">
              <h2>Ready to scan your first page?</h2>
              <p>Open the app on your phone and add it to your home screen for one-tap access.</p>
              <div className="lp-cta-row center">
                <Link href="/scan/" className="lp-btn light">
                  <Ico d={D.camera} size={20} /> Scan documents
                </Link>
                <Link href="/editor/" className="lp-btn outline">
                  <Ico d={D.pen} size={20} /> Edit a PDF
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container">
          <span className="lp-brand sm">
            <span className="lp-logo"><Ico d={D.logo} size={16} /></span>
            Image to PDF
          </span>
          <span>Private by design · Runs in your browser</span>
        </div>
      </footer>
    </div>
  );
}