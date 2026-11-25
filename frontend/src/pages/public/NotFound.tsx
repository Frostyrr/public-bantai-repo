import AuthLayout from "../../components/auth/AuthLayout";

export default function NotFound() {
  return (
    <AuthLayout>
      <p className="mb-2 text-xs font-medium tracking-wider text-zinc-400">404</p>
      <h1 className="mb-3 text-2xl tracking-[-0.02em] sm:text-[28px]">
        <span className="text-display-gradient">Page not found.</span>
      </h1>
      <p className="text-sm text-zinc-400">This page may have moved or the address may be incorrect.</p>
    </AuthLayout>
  );
}
