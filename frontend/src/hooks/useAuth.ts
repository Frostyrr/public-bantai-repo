import { useQuery } from "@tanstack/react-query";
import { getUser } from "../lib/api";
export type { UserProfile } from "../lib/api";
export const AUTH = "auth";
export default function useAuth() {
  const { data: user, ...rest } = useQuery({ queryKey: [AUTH], queryFn: getUser });
  return { user, ...rest };
}
