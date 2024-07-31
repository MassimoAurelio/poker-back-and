let blockers = {
    operationInProgress: false,
    taskRunning: false,
    processing: false,
  };
  
  function withBlocker(blockerKey, callback) {
    if (blockers[blockerKey]) {
      console.log(`Blocker "${blockerKey}" is active. Exiting.`);
      return;
    }
    blockers[blockerKey] = true;
  
    return callback().finally(() => {
      blockers[blockerKey] = false;
      console.log(`Blocker "${blockerKey}" is released.`);
    });
  }