import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen relative flex flex-col items-center justify-center p-6 bg-[url('/hero-pattern.svg')] bg-fixed">
      {/* Background Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-accent/20 blur-[120px] rounded-full pointer-events-none" />

      {/* Header */}
      <nav className="fixed top-0 w-full p-6 flex justify-between items-center max-w-7xl">
        <div className="text-2xl font-bold tracking-tighter text-accent">LaunchGrid</div>
        <div className="flex gap-8 text-sm font-medium text-foreground/60">
          <Link href="#strategy" className="hover:text-accent transition-colors">Strategy</Link>
          <Link href="#workflows" className="hover:text-accent transition-colors">Workflows</Link>
          <Link href="#pricing" className="hover:text-accent transition-colors">Pricing</Link>
          <button className="bg-accent px-4 py-2 rounded-full text-white text-xs hover:glow transition-all">Get Started</button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative z-10 text-center max-w-4xl mt-20">
        <h1 className="text-6xl md:text-8xl font-extrabold tracking-tighter mb-6 bg-gradient-to-b from-white to-foreground/40 bg-clip-text text-transparent">
          Marketing Architecture <br /> for the AI Era.
        </h1>
        <p className="text-xl text-foreground/60 mb-10 max-w-2xl mx-auto leading-relaxed">
          From a static marketing plan to a dynamic, LEGO-like execution engine. 
          Stop getting lost in the process. Build your growth grid.
        </p>

        <div className="flex gap-4 justify-center">
          <button className="bg-white text-black px-8 py-4 rounded-xl font-bold hover:scale-105 transition-transform">
            Build Your Blueprint
          </button>
          <button className="glass px-8 py-4 rounded-xl font-bold hover:bg-white/5 transition-all">
            View Live Demo
          </button>
        </div>
      </section>

      {/* Logic Preview (LEGO Blocks) */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-32 w-full max-w-6xl">
        {[
          { title: "Define Pillars", desc: "Select from pre-defined 2026 mediums like Discord, X, or YouTube.", icon: "🏗️" },
          { title: "Assemble Steps", desc: "Connect intelligent LEGO blocks to automate trend-scanning and drafting.", icon: "🧩" },
          { title: "Execute Copilot", desc: "Approve AI-suggested content and post securely via deep links.", icon: "🚀" }
        ].map((item, i) => (
          <div key={i} className="glass p-8 hover:border-accent/40 transition-colors group">
            <div className="text-4xl mb-4 group-hover:scale-110 transition-transform inline-block">{item.icon}</div>
            <h3 className="text-xl font-bold mb-2">{item.title}</h3>
            <p className="text-foreground/50 text-sm leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </section>

      {/* Footer Meta */}
      <footer className="mt-32 mb-10 text-foreground/30 text-xs tracking-widest uppercase">
        LaunchGrid // The Marketing OS // Version 2.026
      </footer>
    </main>
  );
}
