import { useContext } from 'react';
import { ShellOSContext } from '../contexts/ShellOSContext';

export function useShellOS() {
  return useContext(ShellOSContext);
}
