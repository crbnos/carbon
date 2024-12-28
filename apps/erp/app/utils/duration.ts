export function makeDurations<
  T extends {
    setupTime?: number;
    setupUnit?: string;
    laborTime?: number;
    laborUnit?: string;
    machineTime?: number;
    machineUnit?: string;
    operationQuantity: number | null;
  }
>(
  operation: T
): T & {
  duration: number;
  setupDuration: number;
  laborDuration: number;
  machineDuration: number;
} {
  let setupDuration = 0;
  let laborDuration = 0;
  let machineDuration = 0;

  // Calculate setup duration
  switch (operation.setupUnit) {
    case "Total Hours":
      setupDuration = (operation.setupTime ?? 0) * 3600000; // Convert hours to milliseconds
      break;
    case "Total Minutes":
      setupDuration = (operation.setupTime ?? 0) * 60000; // Convert minutes to milliseconds
      break;
    case "Hours/Piece":
      setupDuration =
        (operation.setupTime ?? 0) *
        (operation.operationQuantity ?? 0) *
        3600000;
      break;
    case "Hours/100 Pieces":
      setupDuration =
        ((operation.setupTime ?? 0) / 100) *
        (operation.operationQuantity ?? 0) *
        3600000;
      break;
    case "Hours/1000 Pieces":
      setupDuration =
        ((operation.setupTime ?? 0) / 1000) *
        (operation.operationQuantity ?? 0) *
        3600000;
      break;
    case "Minutes/Piece":
      setupDuration =
        (operation.setupTime ?? 0) * (operation.operationQuantity ?? 0) * 60000;
      break;
    case "Minutes/100 Pieces":
      setupDuration =
        ((operation.setupTime ?? 0) / 100) *
        (operation.operationQuantity ?? 0) *
        60000;
      break;
    case "Minutes/1000 Pieces":
      setupDuration =
        ((operation.setupTime ?? 0) / 1000) *
        (operation.operationQuantity ?? 0) *
        60000;
      break;
    case "Pieces/Hour":
      setupDuration =
        ((operation.operationQuantity ?? 0) / (operation.setupTime ?? 0)) *
        3600000;
      break;
    case "Pieces/Minute":
      setupDuration =
        ((operation.operationQuantity ?? 0) / (operation.setupTime ?? 0)) *
        60000;
      break;
    case "Seconds/Piece":
      setupDuration =
        (operation.setupTime ?? 0) * (operation.operationQuantity ?? 0) * 1000;
      break;
  }

  // Calculate labor duration
  switch (operation.laborUnit) {
    case "Total Hours":
      laborDuration = (operation.laborTime ?? 0) * 3600000;
      break;
    case "Total Minutes":
      laborDuration = (operation.laborTime ?? 0) * 60000;
      break;
    case "Hours/Piece":
      laborDuration =
        (operation.laborTime ?? 0) *
        (operation.operationQuantity ?? 0) *
        3600000;
      break;
    case "Hours/100 Pieces":
      laborDuration =
        ((operation.laborTime ?? 0) / 100) *
        (operation.operationQuantity ?? 0) *
        3600000;
      break;
    case "Hours/1000 Pieces":
      laborDuration =
        ((operation.laborTime ?? 0) / 1000) *
        (operation.operationQuantity ?? 0) *
        3600000;
      break;
    case "Minutes/Piece":
      laborDuration =
        (operation.laborTime ?? 0) * (operation.operationQuantity ?? 0) * 60000;
      break;
    case "Minutes/100 Pieces":
      laborDuration =
        ((operation.laborTime ?? 0) / 100) *
        (operation.operationQuantity ?? 0) *
        60000;
      break;
    case "Minutes/1000 Pieces":
      laborDuration =
        ((operation.laborTime ?? 0) / 1000) *
        (operation.operationQuantity ?? 0) *
        60000;
      break;
    case "Pieces/Hour":
      laborDuration =
        ((operation.operationQuantity ?? 0) / (operation.laborTime ?? 0)) *
        3600000;
      break;
    case "Pieces/Minute":
      laborDuration =
        ((operation.operationQuantity ?? 0) / (operation.laborTime ?? 0)) *
        60000;
      break;
    case "Seconds/Piece":
      laborDuration =
        (operation.laborTime ?? 0) * (operation.operationQuantity ?? 0) * 1000;
      break;
  }

  // Calculate machine duration
  switch (operation.machineUnit) {
    case "Total Hours":
      machineDuration = (operation.machineTime ?? 0) * 3600000;
      break;
    case "Total Minutes":
      machineDuration = (operation.machineTime ?? 0) * 60000;
      break;
    case "Hours/Piece":
      machineDuration =
        (operation.machineTime ?? 0) *
        (operation.operationQuantity ?? 0) *
        3600000;
      break;
    case "Hours/100 Pieces":
      machineDuration =
        ((operation.machineTime ?? 0) / 100) *
        (operation.operationQuantity ?? 0) *
        3600000;
      break;
    case "Hours/1000 Pieces":
      machineDuration =
        ((operation.machineTime ?? 0) / 1000) *
        (operation.operationQuantity ?? 0) *
        3600000;
      break;
    case "Minutes/Piece":
      machineDuration =
        (operation.machineTime ?? 0) *
        (operation.operationQuantity ?? 0) *
        60000;
      break;
    case "Minutes/100 Pieces":
      machineDuration =
        ((operation.machineTime ?? 0) / 100) *
        (operation.operationQuantity ?? 0) *
        60000;
      break;
    case "Minutes/1000 Pieces":
      machineDuration =
        ((operation.machineTime ?? 0) / 1000) *
        (operation.operationQuantity ?? 0) *
        60000;
      break;
    case "Pieces/Hour":
      machineDuration =
        ((operation.operationQuantity ?? 0) / (operation.machineTime ?? 0)) *
        3600000;
      break;
    case "Pieces/Minute":
      machineDuration =
        ((operation.operationQuantity ?? 0) / (operation.machineTime ?? 0)) *
        60000;
      break;
    case "Seconds/Piece":
      machineDuration =
        (operation.machineTime ?? 0) *
        (operation.operationQuantity ?? 0) *
        1000;
      break;
  }

  const totalDuration = setupDuration + laborDuration + machineDuration;

  // @ts-ignore
  return {
    ...operation,
    duration: totalDuration,
    setupDuration,
    laborDuration,
    machineDuration,
  };
}
