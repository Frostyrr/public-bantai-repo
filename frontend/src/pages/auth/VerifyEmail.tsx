import AuthLayout from "../../components/auth/AuthLayout";
export default function VerifyEmail() {
  return <AuthLayout returnTo="/login"><h1 className="text-2xl tracking-tight"><span className="text-display-gradient">Request a new verification link</span></h1><p className="text-sm text-zinc-400">Verification links from the previous authentication system are no longer supported.</p></AuthLayout>;
}
