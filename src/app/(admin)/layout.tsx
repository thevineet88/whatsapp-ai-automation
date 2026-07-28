import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>
      <header style={{ marginBottom: "2rem" }}>
        <strong>Samyati Holidays &mdash; Admin</strong>
        <nav style={{ marginTop: "0.5rem" }}>
          <Link href="/packages">Packages</Link>
          {" · "}
          <Link href="/config">Config</Link>
        </nav>
      </header>
      <style>{`
        input, select, textarea {
          width: 100%;
          padding: 0.4rem;
          font: inherit;
          box-sizing: border-box;
        }
      `}</style>
      {children}
    </div>
  );
}
