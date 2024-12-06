import {
  Avatar,
  AvatarGroup,
  HStack,
  IconButton,
  Input as InputBase,
  InputGroup,
  InputLeftElement,
  InputRightElement,
  Spinner,
} from "@carbon/react";
import { LuX } from "react-icons/lu";
import useUserSelectContext from "../provider";

const Input = () => {
  const {
    aria: { inputProps },
    innerProps: { disabled, isMulti, placeholder, readOnly },
    inputValue,
    loading,
    refs: { inputRef },
    onClearInput,
    onInputBlur,
    onInputChange,
    onInputFocus,
  } = useUserSelectContext();

  return (
    <InputGroup>
      {!readOnly &&
        (isMulti ? (
          <InputLeftElement>
            <AvatarGroup size="xs" limit={2}>
              <Avatar size="xs" />
              <Avatar size="xs" />
            </AvatarGroup>
          </InputLeftElement>
        ) : (
          <InputLeftElement>
            <Avatar size="xs" />
          </InputLeftElement>
        ))}

      <InputBase
        {...inputProps}
        isReadOnly={disabled || readOnly}
        isDisabled={disabled || readOnly}
        onBlur={onInputBlur}
        onChange={onInputChange}
        onFocus={readOnly || disabled ? undefined : onInputFocus}
        placeholder={placeholder}
        spellCheck="false"
        ref={inputRef}
        type="text"
        value={inputValue}
      />
      {!readOnly && !disabled && (
        <InputRightElement>
          <HStack spacing={1}>
            {loading && <Spinner />}
            {!loading && !disabled && inputValue.length > 0 && (
              <IconButton
                aria-label="Clear search query"
                icon={<LuX />}
                onClick={onClearInput}
                variant="ghost"
              />
            )}
          </HStack>
        </InputRightElement>
      )}
    </InputGroup>
  );
};

export default Input;
