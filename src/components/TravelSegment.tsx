'use client';

import { motion } from 'framer-motion';
import { TravelSegment as TravelSegmentType } from '@/lib/types';
import { formatDuration, formatDistance } from '@/lib/timeUtils';

interface TravelSegmentProps {
  segment: TravelSegmentType | undefined;
  teamColor: string;
  onAddBreak?: () => void;
}

export default function TravelSegment({ segment, teamColor, onAddBreak }: TravelSegmentProps) {
  if (!segment) return null;

  return (
    <div className="travel-connector group" style={{ '--color-border': teamColor } as React.CSSProperties}>
      <div className="flex items-center gap-2 py-1">
        {segment.isCalculating ? (
          <div className="flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={teamColor} strokeWidth="2.5" className="animate-spin opacity-60">
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
            <span className="text-xs text-text-tertiary italic">Calculating...</span>
          </div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-xs">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={teamColor} strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            <span className="font-medium" style={{ color: teamColor }}>{formatDuration(segment.durationMinutes)}</span>
            <span className="text-text-tertiary">·</span>
            <span className="text-text-tertiary">{formatDistance(segment.distanceKm)}</span>
            {onAddBreak && (
              <button onClick={onAddBreak}
                className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-text-tertiary hover:text-primary text-xs"
                title="Add break">+ Break</button>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
