import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, LayoutDashboard, ListChecks, Plus, Users, Wrench, X } from "lucide-react";
import type { NavDestination } from "../services/navigation";
import "./AppHeader.css";
export interface AppHeaderProps {
  current: NavDestination | "dashboard" | "request" | "workspace" | "customer";
  onNavigate: (destination: NavDestination) => void;
  back?: { label: string; onClick: () => void };
  subtitle?: ReactNode; actions?: ReactNode; context?: string; busy?: string;
}
export default function AppHeader({current, onNavigate, back, subtitle, actions, context, busy}: AppHeaderProps) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const toolsButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = headerRef.current;
    if (!node) return;
    const publish = () => document.documentElement.style.setProperty("--app-header-height", node.offsetHeight + "px");
    publish(); const observer = new ResizeObserver(publish); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setToolsOpen(false), [current]);
  useEffect(() => {
    if (!toolsOpen) return;
    const dismiss = (e: PointerEvent) => { if (!toolsRef.current?.contains(e.target as Node)) setToolsOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { setToolsOpen(false); toolsButton.current?.focus(); } };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [toolsOpen]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const editing = document.activeElement?.matches("input,textarea,[contenteditable=true]");
      const open = Boolean(editing && viewport && window.innerHeight - viewport.height > 120);
      setKeyboardOpen(open); document.documentElement.classList.toggle("keyboard-open", open);
    };
    viewport?.addEventListener("resize", update); document.addEventListener("focusout", update);
    return () => { viewport?.removeEventListener("resize", update); document.removeEventListener("focusout", update); document.documentElement.classList.remove("keyboard-open"); };
  }, []);
  const navigate = (destination: NavDestination) => { setToolsOpen(false); onNavigate(destination); };
  const active = (id: string) => (id === "home" ? current === "dashboard" : current === id) || (id === "review" && current === "request") || (id === "workspaces" && current === "workspace") || (id === "customers" && current === "customer");
  return <>
    <header className="app-header" ref={headerRef}>
      <div className="app-header-row">
        <a className="brand" href="#/" aria-label="Hays + Sons change orders home" onClick={e => { e.preventDefault(); navigate("home"); }}>
          <svg viewBox="0 0 65 42" aria-hidden="true"><rect width="14" height="42" fill="#dc2626"/><rect x="36" width="14" height="42" fill="#1a1a1a"/><rect x="14" y="14" width="51" height="14" fill="#1a1a1a"/></svg>
          <div><strong>Hays+Sons</strong><span>CHANGE ORDERS</span></div>
        </a>
        <div className="app-header-tools">
          {context && <span className="local-label">{context}</span>}{actions}
          <nav className="desktop-nav" aria-label="Main navigation">
            <button className={"nav-link nav-home" + (active("home") ? " is-current" : "")} aria-current={active("home") ? "page" : undefined} onClick={() => navigate("home")}>Home</button>
            <button className={"nav-link" + (active("review") ? " is-current" : "")} aria-current={active("review") ? "page" : undefined} onClick={() => navigate("review")}>Requests</button>
            <button className={"nav-link" + (active("customers") ? " is-current" : "")} aria-current={active("customers") ? "page" : undefined} onClick={() => navigate("customers")}>Customers</button>
            <button className={"nav-link" + (active("workspaces") ? " is-current" : "")} aria-current={active("workspaces") ? "page" : undefined} onClick={() => navigate("workspaces")}>Jobs & Documents</button>
          </nav>
          <div className="tools-menu" ref={toolsRef}>
            <button ref={toolsButton} className="button tools-toggle" aria-expanded={toolsOpen} aria-controls="app-tools" onClick={() => setToolsOpen(!toolsOpen)}>{toolsOpen ? <X size={17}/> : <Wrench size={17}/>} Tools</button>
            {toolsOpen && <nav id="app-tools" className="tools-popover" aria-label="Tools">
              <p>Import & maintenance</p>
              <button onClick={() => navigate("jobs")}>Import jobs <small>Replace the job directory</small></button>
              <button onClick={() => navigate("migration")}>Import document jobs <small>Bring existing saved jobs into this app</small></button>
              <button onClick={() => navigate("reference")}>Customer reference CSV <small>Manage the stored reference file</small></button>
            </nav>}
          </div>
          {current !== "simple" && <button className="button primary desktop-new-request" onClick={() => navigate("simple")}><Plus size={18}/> New request</button>}
        </div>
      </div>
      {(back || subtitle) && <div className="app-header-sub">{back && <button className="app-back" onClick={back.onClick}><ArrowLeft size={17}/>{back.label}</button>}{subtitle && <span className="app-subtitle">{subtitle}</span>}</div>}
      {busy && <div className="app-progress" role="status" aria-label={busy}><span/></div>}
    </header>
    <nav className={"mobile-nav" + (keyboardOpen ? " is-hidden" : "")} aria-label="Phone navigation">
      <button aria-current={active("home") ? "page" : undefined} onClick={() => navigate("home")}><LayoutDashboard size={20}/><span>Home</span></button>
      <button aria-current={active("customers") ? "page" : undefined} onClick={() => navigate("customers")}><Users size={20}/><span>Customers</span></button>
      <button className="mobile-create" aria-current={current === "simple" ? "page" : undefined} onClick={() => navigate("simple")}><Plus size={22}/><span>New request</span></button>
      <button aria-current={active("workspaces") ? "page" : undefined} onClick={() => navigate("workspaces")}><ListChecks size={20}/><span>Jobs</span></button>
    </nav>
  </>;
}
