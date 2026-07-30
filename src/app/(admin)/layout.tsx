import { isAdminAuthenticated } from "@/lib/admin/auth";
import { tenants } from "@/lib/db/schema";
import { getServerDb } from "@/lib/db/serverDb";
import { getActiveTenantConfig } from "@/lib/db/tenantConfig";
import LoginForm from "./login-form";

// All admin pages query the database at request time. Preventing Next.js
// from trying to prerender any of them during `next build`.
export const dynamic = "force-dynamic";

async function AdminGuard({ children }: { children: React.ReactNode }) {
  const db = getServerDb();
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) return <p>No tenant found.</p>;

  const config = await getActiveTenantConfig(db, tenant.id);
  if (!config) return <p>No active tenant config.</p>;

  if (!(config.config as { adminPassword?: string }).adminPassword) {
    return (
      <>
        {children}
        <p className="warning-banner">
          No admin password set. Set one in <a href="/config">Config</a> before using the admin
          panel.
        </p>
      </>
    );
  }

  const authenticated = await isAdminAuthenticated(config.config);
  if (!authenticated) {
    return <LoginForm />;
  }

  return <>{children}</>;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGuard>
      <div className="admin-layout">
        <header className="admin-header">
          <div>
            <h1>Samyati Holidays</h1>
            <span className="subtitle">Admin Panel</span>
          </div>
          <nav>
            <a href="/conversations">Conversations</a>
            <a href="/packages">Packages</a>
            <a href="/config">Config</a>
          </nav>
        </header>
        <main>{children}</main>
      </div>
    </AdminGuard>
  );
}
