import {
  describeReasonShortfall,
  resolutionExceptionShortfall,
  RESOLUTION_EXCEPTION_MIN_LENGTH,
} from '@snag/supabase-queries';

// The minimum length on a resolution exception, said out loud.
//
// The rule itself is the server's: update_snag_status and
// record_resolution_exception both `btrim` the reason and refuse anything under
// ten characters. What these specs pin is the client's account of it, because
// that account was the actual defect — a supervisor typed "Mean man", got back
// "Explain why this was closed with the investigation incomplete", and had no
// way to tell that length was the thing being judged. The button stayed
// enabled, nothing named the minimum, and the rejection was the prompt
// reworded, so it read as the app doing nothing at all.
//
// So: the shortfall has to be non-null for exactly the inputs the server
// refuses, and it has to mention the number.

describe('resolutionExceptionShortfall', () => {
  it('is zero once the reason meets the minimum', () => {
    expect(resolutionExceptionShortfall('a'.repeat(RESOLUTION_EXCEPTION_MIN_LENGTH))).toBe(0);
    expect(resolutionExceptionShortfall('Contractor left the site and cannot be reached.')).toBe(0);
  });

  it('counts what is still missing', () => {
    expect(resolutionExceptionShortfall('')).toBe(RESOLUTION_EXCEPTION_MIN_LENGTH);
    expect(resolutionExceptionShortfall('This')).toBe(RESOLUTION_EXCEPTION_MIN_LENGTH - 4);
    expect(resolutionExceptionShortfall('Mean man')).toBe(2);
  });

  // Both RPCs btrim before measuring, so a client that counted raw length would
  // enable the button on ten spaces and then be refused by the server.
  it('measures the trimmed reason, as the server does', () => {
    expect(resolutionExceptionShortfall('   '.repeat(10))).toBe(RESOLUTION_EXCEPTION_MIN_LENGTH);
    expect(resolutionExceptionShortfall('  Mean man  ')).toBe(2);
  });
});

describe('describeReasonShortfall', () => {
  it('says nothing once the reason is long enough', () => {
    expect(describeReasonShortfall('Hazard removed, area barricaded.')).toBeNull();
    expect(describeReasonShortfall('a'.repeat(RESOLUTION_EXCEPTION_MIN_LENGTH))).toBeNull();
  });

  it('states the minimum before anything is typed', () => {
    expect(describeReasonShortfall('')).toContain(String(RESOLUTION_EXCEPTION_MIN_LENGTH));
    expect(describeReasonShortfall('   ')).toBe(describeReasonShortfall(''));
  });

  it('counts down once there is something to count', () => {
    expect(describeReasonShortfall('Mean man')).toBe('2 more characters.');
    expect(describeReasonShortfall('Mean mans')).toBe('1 more character.');
  });
});
