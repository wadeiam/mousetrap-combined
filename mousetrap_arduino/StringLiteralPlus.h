// StringLiteralPlus.h
#pragma once
#include <Arduino.h>

/*  lets  "literal" + anything   work the same as   String("literal") + anything */
template <typename T>
inline String operator+(const char* lhs, const T& rhs)
{
  String s(lhs);           // promote the left literal
  s += String(rhs);        // stringify & append rhs (works for int, const char*, String…)
  return s;                // enables further + chaining
}
