export function adultAccessEnabled(instanceEnabled: boolean, accountGrant: boolean) {
  return instanceEnabled && accountGrant;
}
