"use client";

import dynamic from 'next/dynamic';

const MeetingFixerClient = dynamic(() => import('./MeetingFixerClient'), {
  ssr: false,
});

export default function MeetingFixerPage() {
  return <MeetingFixerClient />;
}
