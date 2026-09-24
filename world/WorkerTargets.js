export function targetClaimedByAnother(target, worker, workers) {
  return workers.some(other => other !== worker && other.userData.alive &&
    other.userData.kind === worker.userData.kind && other.userData.target === target &&
    String(other.userData.id) < String(worker.userData.id));
}

export function nearestUnclaimedTarget(candidates, worker, workers) {
  const claimed = new Set(workers
    .filter(other => other !== worker && other.userData.alive && other.userData.kind === worker.userData.kind)
    .map(other => other.userData.target)
    .filter(Boolean));
  let best = null;
  let bestDistance = Infinity;
  for (const target of candidates) {
    if (!target.userData.alive || claimed.has(target)) continue;
    const dx = target.position.x - worker.position.x;
    const dz = target.position.z - worker.position.z;
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}
