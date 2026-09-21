"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { Spinner } from "@/components/ui";

export default function Home() {
  const { me, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(me ? "/app" : "/login");
  }, [me, loading, router]);

  return <Spinner />;
}
