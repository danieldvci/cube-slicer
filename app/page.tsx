"use client";

import dynamic from "next/dynamic";

const CubeSlicerApp = dynamic(() => import("@/components/CubeSlicerApp"), {
  ssr: false,
  loading: () => (
    <div className="w-screen h-screen bg-[#0a0a15] flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 mx-auto mb-4 border-2 border-[#2A9D8F] border-t-transparent rounded-full animate-spin" />
        <p className="text-xs tracking-[0.2em] uppercase text-white/30 font-mono">
          Initializing geometry engine...
        </p>
      </div>
    </div>
  ),
});

export default function Home() {
  return <CubeSlicerApp />;
}
