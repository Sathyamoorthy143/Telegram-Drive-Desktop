import { useState, lazy, Suspense } from 'react';
import {
  Cloud, Menu, X, Database, Send, Server, Upload,
  Phone, ArrowRight, Globe, Cpu, Check,
  Facebook, Github, Twitch, Twitter, Instagram,
} from 'lucide-react';
import teamBg from '../../assets/Team.png';
import { TiltCard } from '../three/TiltCard';

// WebGL scenes carry three.js (~700KB gz) — keep them out of the main bundle
// and render the rest of the page immediately.
const CloudHero3D = lazy(() => import('../three/CloudHero3D').then((m) => ({ default: m.CloudHero3D })));
const Scene3D = lazy(() => import('../three/Scene3D').then((m) => ({ default: m.Scene3D })));

interface LandingProps {
  onSignIn: () => void;
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function Landing({ onSignIn }: LandingProps) {
  const [nav, setNav] = useState(false);

  return (
    <div className="cs-landing">
      <header className="w-screen h-10 md:h-20 z-20 bg-zinc-200 fixed top-0 left-0 drop-shadow-lg">
        <div className="flex justify-between items-center px-2 w-full h-full">
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => scrollToId('home')}
              className="flex items-center text-blue-900 gap-2 text-2xl md:text-3xl font-black uppercase"
            >
              <Cloud className="h-8 w-8 md:h-10 md:w-10 text-blue-900" />
              Cloud
            </button>
          </div>

          <nav className="hidden md:flex px-20">
            <ul className="flex gap-x-10">
              {[
                ['home', 'Home'],
                ['about', 'About'],
                ['support', 'Support'],
                ['platforms', 'Platforms'],
                ['pricing', 'Pricing'],
              ].map(([id, label]) => (
                <li key={id}>
                  <button type="button" onClick={() => scrollToId(id)} className="cs-nav-link text-zinc-900">
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="hidden md:flex items-center">
            <button type="button" onClick={onSignIn} className="cs-btn-ghost py-2 px-5 mx-1 cursor-pointer">
              Sign In
            </button>
            <button type="button" onClick={onSignIn} className="cs-btn-navy py-2 px-5 mx-4 cursor-pointer">
              Sign Up
            </button>
          </div>

          <button type="button" className="md:hidden cursor-pointer p-2" onClick={() => setNav(!nav)} aria-label="Menu">
            {nav ? <X className="w-6 h-6 text-blue-900" /> : <Menu className="w-6 h-6 text-blue-900" />}
          </button>
        </div>

        {nav && (
          <div className="md:hidden bg-zinc-200 px-4 py-2 drop-shadow-lg">
            <ul className="space-y-1">
              {[
                ['home', 'Home'],
                ['about', 'About'],
                ['support', 'Support'],
                ['platforms', 'Platforms'],
                ['pricing', 'Pricing'],
              ].map(([id, label]) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => { scrollToId(id); setNav(false); }}
                    className="font-bold cursor-pointer border-b-2 border-blue-900 py-2 w-full text-left text-zinc-900"
                  >
                    {label}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-col gap-4 pb-4">
              <button type="button" onClick={onSignIn} className="cs-btn-ghost py-2 px-5 border border-blue-900 cursor-pointer">
                Sign In
              </button>
              <button type="button" onClick={onSignIn} className="cs-btn-navy py-2 px-5 cursor-pointer">
                Sign Up
              </button>
            </div>
          </div>
        )}
      </header>

      <section id="home" className="w-full min-h-screen bg-zinc-200 flex flex-col justify-between text-center relative pt-20">
        <div className="grid md:grid-cols-2 max-w-[1240px] m-auto px-4 pb-40 md:pb-32">
          <div className="flex flex-col justify-center md:items-start w-full py-4">
            <p className="text-lg sm:text-xl md:text-2xl text-zinc-700">Unique Sequencing &amp; Production</p>
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-7xl font-black py-3 text-zinc-900">
              Cloud Management
            </h1>
            <p className="text-base sm:text-lg md:text-2xl text-zinc-700">This is our Tech brand.</p>
            <button
              type="button"
              onClick={onSignIn}
              className="cs-btn-navy py-2 sm:py-3 px-4 sm:px-6 rounded mt-4 mx-auto md:mx-0 w-[70%] sm:w-[50%] md:w-auto cursor-pointer"
            >
              Get Started
            </button>
          </div>
          <div className="flex justify-center items-center mt-6 md:mt-0">
            {/* Interactive 3D hero cloud — parallax-follows the pointer */}
            <Suspense fallback={<div className="w-full aspect-square max-w-[300px] md:max-w-[500px]" />}>
              <CloudHero3D className="w-full aspect-square max-w-[300px] md:max-w-[500px]" />
            </Suspense>
          </div>
        </div>

        <div className="absolute flex flex-col py-6 w-[90%] sm:w-[80%] md:min-w-[760px] bottom-[2%] left-1/2 -translate-x-1/2 bg-zinc-200 border border-slate-300 rounded-xl text-center shadow-xl">
          <p className="text-blue-900 font-black text-xl sm:text-2xl mb-2">Data Services</p>
          <div className="flex flex-wrap justify-center sm:justify-between px-2 sm:px-4">
            <p className="flex items-center px-3 py-2 text-slate-800 text-sm sm:text-base">
              <Upload className="h-5 sm:h-6 text-blue-900 mr-2" /> App Security
            </p>
            <p className="flex items-center px-3 py-2 text-slate-800 text-sm sm:text-base">
              <Database className="h-5 sm:h-6 text-blue-900 mr-2" /> Dashboard Design
            </p>
            <p className="flex items-center px-3 py-2 text-slate-800 text-sm sm:text-base">
              <Server className="h-5 sm:h-6 text-blue-900 mr-2" /> Cloud Data
            </p>
            <p className="flex items-center px-3 py-2 text-slate-800 text-sm sm:text-base">
              <Send className="h-5 sm:h-6 text-blue-900 mr-2" /> API
            </p>
          </div>
        </div>
      </section>

      <section id="about" className="w-full my-32 bg-zinc-200">
        <div className="max-w-[1024px] mx-auto px-4">
          <div className="text-center">
            <h2 className="text-3xl md:text-5xl font-bold text-zinc-900">Trusted by Developers across the world</h2>
            <p className="text-2xl md:text-3xl py-6 text-gray-600">
              To provide top-notch cloud management solutions that empower businesses.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-4 px-2 text-center">
            <TiltCard className="py-10 rounded-xl shadow-xl bg-white">
              <p className="text-blue-900 text-6xl font-black">100%</p>
              <p className="text-gray-400 mt-2">Completion</p>
            </TiltCard>
            <TiltCard className="py-10 rounded-xl shadow-xl bg-white">
              <p className="text-blue-900 text-6xl font-black">24/7</p>
              <p className="text-gray-400 mt-2">Delivery</p>
            </TiltCard>
            <TiltCard className="py-10 rounded-xl shadow-xl bg-white">
              <p className="text-blue-900 text-6xl font-black">100K</p>
              <p className="text-gray-400 mt-2">Transactions</p>
            </TiltCard>
          </div>
        </div>
      </section>

      <section id="support" className="w-full my-24 relative pb-24">
        <div className="w-full h-[600px] bg-gray-900/90 absolute top-0 left-0">
          <img className="w-full h-full object-cover mix-blend-overlay" src={teamBg} alt="Team" />
        </div>
        <div className="max-w-[1240px] mx-auto text-white relative">
          <div className="px-4 py-12 text-center">
            <h2 className="pt-8 text-slate-300 uppercase tracking-widest text-sm font-bold">Support</h2>
            <h3 className="text-5xl font-bold py-6">Finding the right team.</h3>
            <p className="text-2xl md:text-3xl text-slate-300">
              If you have any questions or need assistance, feel free to reach out to us.
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 relative gap-x-8 gap-y-16 px-4 pt-12 sm:pt-20 text-black">
            {[
              [Phone, 'Sales', 'Talk with our team about plans, storage limits, and organization onboarding.'],
              [Globe, 'Technical Support', 'Get help with Telegram auth, uploads, streaming, and self-hosted deployments.'],
              [Cpu, 'Media Inquiries', 'Press and partnership requests for Cloudsphere Space.'],
            ].map(([Icon, title, copy]) => {
              const Glyph = Icon as typeof Phone;
              return (
                <TiltCard key={String(title)} className="rounded-xl shadow-xl bg-white" intensity={6}>
                  <div className="p-8">
                    <Glyph className="text-white bg-blue-900 w-16 h-12 p-2 rounded-lg mt-[-4rem]" />
                    <h3 className="font-bold text-blue-900 text-2xl my-6">{title as string}</h3>
                    <p className="text-gray-600 text-xl">{copy as string}</p>
                  </div>
                  <button
                    type="button"
                    onClick={onSignIn}
                    className="flex gap-2 items-center bg-blue-50 py-1.5 px-5 text-blue-900 font-bold w-full"
                  >
                    Contact Us <ArrowRight className="w-5" />
                  </button>
                </TiltCard>
              );
            })}
          </div>
        </div>
      </section>

      <section id="platforms" className="w-full my-24 md:mt-40 bg-zinc-200">
        <div className="text-center px-4">
          <h2 className="text-4xl md:text-7xl py-4 font-black text-zinc-900">All-In-One Platform</h2>
          <p className="text-xl text-zinc-600">Experience the ultimate solution for all your cloud management needs.</p>
        </div>
        <div className="grid sm:grid-cols-2 md:grid-cols-4 place-items-center max-w-[1024px] w-full mx-auto gap-4 px-10 mt-10">
          {[
            ['Unlimited Storage', 'Turn Telegram into private cloud storage with folders, search, and streaming.'],
            ['Secure Auth', 'Phone OTP and 2FA keep every workspace locked to your Telegram account.'],
            ['File Workspace', 'Grid and list views, previews, versions, tags, and bulk actions.'],
            ['Org Controls', 'Role-based access, folder grants, and activity logs for teams.'],
            ['Media Playback', 'Stream video and audio, preview images, and open documents in place.'],
            ['Upload Pipeline', 'Drag-and-drop files and folders with live progress, pause, and retry.'],
            ['Encrypted Files', 'Optional client-side encryption before anything leaves your browser.'],
            ['Self-Hosted', 'Run the stack on your own VPS, Docker, or Cloudflare Pages.'],
          ].map(([title, copy]) => (
            <div key={title} className="flex">
              <Check size={20} className="text-blue-800 mt-1 mr-2 shrink-0" />
              <div>
                <h3 className="text-2xl font-bold text-zinc-900">{title}</h3>
                <p className="text-base py-4 leading-normal text-zinc-600">{copy}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="w-full my-24 relative">
        <div className="absolute w-full h-[520px] bg-slate-900 top-0 left-0 overflow-hidden">
          {/* Floating 3D shapes behind the pricing header */}
          <Suspense fallback={null}>
            <Scene3D variant="dark" className="absolute inset-0 opacity-60" particleCount={90} />
          </Suspense>
        </div>
        <div className="max-w-[1024px] mx-auto py-12 relative">
          <div className="text-center py-8 text-slate-300">
            <h2 className="text-2xl uppercase tracking-widest">Pricing</h2>
            <h3 className="text-4xl md:text-5xl font-black text-white py-8">The right price for your research.</h3>
            <p className="text-2xl md:text-3xl px-2">
              Get started with our free plan, or choose a paid plan for more advanced features.
            </p>
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-1 place-items-center max-w-[1024px] mx-auto relative px-2">
          <TiltCard className="bg-white text-slate-900 m-4 p-8 rounded-xl shadow-2xl relative w-[min(100%,28rem)]" intensity={5}>
            <span className="bg-blue-300 px-4 py-2 rounded-xl uppercase font-bold">Standard</span>
            <h2 className="text-6xl font-bold mt-5 text-blue-900">$49<span className="text-2xl text-slate-500">/mo</span></h2>
            <p className="text-xl py-8 text-slate-500">Personal workspace with Telegram-backed files, search, and media preview.</p>
            {['Unlimited Telegram storage', 'Grid and list explorer', 'Upload, preview, and stream', 'Activity log and versions'].map((item) => (
              <p key={item} className="flex gap-2 text-lg py-3 items-start">
                <Check size={20} className="text-blue-900 mt-1 shrink-0" />{item}
              </p>
            ))}
            <button type="button" onClick={onSignIn} className="w-full h-12 cs-btn-navy rounded-xl my-2 cursor-pointer">
              Get Started
            </button>
          </TiltCard>
          <TiltCard className="bg-white text-slate-900 m-4 p-8 rounded-xl shadow-2xl relative w-[min(100%,28rem)]" intensity={5}>
            <span className="bg-blue-300 px-4 py-2 rounded-xl uppercase font-bold">Premium</span>
            <h2 className="text-6xl font-bold mt-5 text-blue-900">$99<span className="text-2xl text-slate-500">/mo</span></h2>
            <p className="text-xl py-8 text-slate-500">Organization workspaces with roles, folder grants, and admin controls.</p>
            {['Everything in Standard', 'Multi-org administration', 'Folder-scoped permissions', 'Priority support'].map((item) => (
              <p key={item} className="flex gap-2 text-lg py-3 items-start">
                <Check size={20} className="text-blue-900 mt-1 shrink-0" />{item}
              </p>
            ))}
            <button type="button" onClick={onSignIn} className="w-full h-12 cs-btn-navy rounded-xl my-2 cursor-pointer">
              Get Started
            </button>
          </TiltCard>
        </div>
      </section>

      <footer className="w-full mt-24 bg-slate-900 text-gray-300 py-8 px-2">
        <div className="max-w-[1240px] mx-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 border-b-2 border-gray-600 py-8 gap-6">
          <div>
            <h6 className="font-bold uppercase pt-2 text-xl">Solutions</h6>
            <ul>
              {['Marketing', 'Analytics', 'Commerce', 'Data', 'Cloud'].map((item) => (
                <li key={item} className="py-1">{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h6 className="font-bold uppercase pt-2 text-xl">Support</h6>
            <ul>
              {['Pricing', 'Documentation', 'Guides', 'API Status'].map((item) => (
                <li key={item} className="py-1">{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h6 className="font-bold uppercase pt-2 text-xl">Company</h6>
            <ul>
              {['About', 'Blog', 'Jobs', 'Press', 'Partners'].map((item) => (
                <li key={item} className="py-1">{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h6 className="font-bold uppercase pt-2 text-xl">Legal</h6>
            <ul>
              {['Claims', 'Privacy', 'Terms', 'Policies', 'Conditions'].map((item) => (
                <li key={item} className="py-1">{item}</li>
              ))}
            </ul>
          </div>
          <div className="col-span-1 sm:col-span-2 md:col-span-2 pt-8 md:pt-2">
            <p className="text-2xl font-black uppercase">Subscribe to our Newsletter</p>
            <p className="text-gray-400 my-2">The latest news, articles, and resources, sent to your inbox weekly.</p>
            <form
              className="flex flex-col sm:flex-row gap-3"
              onSubmit={(e) => { e.preventDefault(); onSignIn(); }}
            >
              <input
                type="email"
                className="p-2 rounded-md w-full sm:w-[250px] text-blue-900 bg-white"
                placeholder="Enter Email"
              />
              <button type="submit" className="w-full sm:w-[120px] cs-btn-navy rounded-xl p-2">
                Subscribe
              </button>
            </form>
          </div>
          <div className="col-span-1 sm:col-span-2 md:col-span-6 border-t-2 border-gray-600 mt-8 pt-8 text-center">
            <p className="text-slate-400 font-bold">2026 Cloudsphere Space</p>
            <div className="flex justify-center gap-10 pt-5">
              <Facebook className="text-blue-500 w-6 h-6" />
              <Instagram className="text-blue-500 w-6 h-6" />
              <Twitch className="text-blue-500 w-6 h-6" />
              <Twitter className="text-blue-500 w-6 h-6" />
              <Github className="text-blue-500 w-6 h-6" />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
