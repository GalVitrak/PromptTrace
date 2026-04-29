import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden />
            <span className="brand-name">PromptTrace</span>
            <span className="brand-tag">Workbench</span>
          </Link>
          <nav className="nav-links">
            <NavLink
              to="/"
              className={({ isActive }) => (isActive ? "active" : "")}
              end
            >
              Red Team mode
            </NavLink>
            <NavLink
              to="/ctf"
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              CTF mode
            </NavLink>
            <NavLink
              to="/sessions/new"
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              New session
            </NavLink>
          </nav>
        </div>
      </header>

      <div className="disclaimer" role="note">
        <strong>Authorized use only.</strong> PromptTrace is a human-in-the-loop
        tool for AI safety testing, red teaming, and research workflows. Analysts
        are responsible for compliance with policy and law. Generated assessments
        are assistant output, not ground truth.
      </div>

      <main className="main">{children}</main>
    </div>
  );
}
